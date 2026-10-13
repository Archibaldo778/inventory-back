import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { extractDropboxDocxLines } from './dropboxDocxMetadata.js';

export const ASSISTANT_FILE_LIMIT = 8 * 1024 * 1024;
export const ASSISTANT_TOTAL_LIMIT = 20 * 1024 * 1024;
export const assistantFileError = (message) => Object.assign(new Error(message), { statusCode: 400 });
export async function prepareAssistantAttachments(files = []) {
  if (!Array.isArray(files) || files.length > 5) throw assistantFileError('Attach up to 5 files per message');
  if (files.reduce((sum, file) => sum + (file.buffer?.length || 0), 0) > ASSISTANT_TOTAL_LIMIT) throw assistantFileError('Attachments must total 20 MB or less');
  const content = [];
  const names = [];
  for (const file of files) {
    const buffer = file.buffer;
    const name = String(file.originalname || 'attachment').split(/[\\/]/).pop().slice(0, 180);
    if (!buffer?.length || buffer.length > ASSISTANT_FILE_LIMIT) throw assistantFileError('Each file must be nonempty and no larger than 8 MB');
    const extension = name.split('.').pop().toLowerCase();
    if (extension === 'docx') {
      let text;
      try {
        const zip = await JSZip.loadAsync(buffer);
        const entry = zip.file('word/document.xml');
        if (!entry || !Number.isFinite(entry._data?.uncompressedSize) || entry._data.uncompressedSize > 2 * 1024 * 1024) throw new Error();
        text = extractDropboxDocxLines(await entry.async('string')).join('\n');
      } catch { throw assistantFileError('Could not read this DOCX. Upload a valid Word document or PDF.'); }
      if (!text.trim() || text.length > 100000) throw assistantFileError('DOCX text is empty or too long. Upload the relevant pages.');
      content.push({ type: 'input_text', text: JSON.stringify({ file: name, documentText: text }) });
    } else if (extension === 'pdf' && buffer.subarray(0, 5).toString() === '%PDF-') {
      try {
        const pdf = await PDFDocument.load(buffer);
        if (pdf.getPageCount() > 40) throw new Error();
      } catch { throw assistantFileError('Upload an unlocked PDF with no more than 40 pages'); }
      content.push({ type: 'input_file', filename: name, file_data: `data:application/pdf;base64,${buffer.toString('base64')}` });
    } else {
      const png = extension === 'png' && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = ['jpg', 'jpeg'].includes(extension) && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
      const webp = extension === 'webp' && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
      if (!png && !jpeg && !webp) throw assistantFileError('Supported files: PDF, DOCX, PNG, JPG and WebP');
      const mime = png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp';
      content.push({ type: 'input_text', text: JSON.stringify({ imageFile: name }) }, { type: 'input_image', image_url: `data:${mime};base64,${buffer.toString('base64')}`, detail: 'high' });
    }
    names.push(name);
  }
  return { content, names };
}
