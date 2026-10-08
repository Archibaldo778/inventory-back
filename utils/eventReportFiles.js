import { loadReportPhotoData } from './eventReportPhotos.js';
import crypto from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { createApiError } from './apiErrors.js';
import { renderEventReportText } from './eventReportEmail.js';
import { convertLeadershipFileToPdf } from './leadershipPrintPdf.js';

export const MAX_REPORT_PDF_BYTES = 10 * 1024 * 1024;
export const reportFileName = (value) => String(value || 'report.pdf').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 180);
export const publicReportFile = (file) => ({
  id: String(file._id), eventId: String(file.eventId), fileName: file.fileName,
  size: file.size, pageCount: file.pageCount, uploadedBy: file.uploadedBy, createdAt: file.createdAt,
});

export const validateReportPdf = async (file) => {
  if (!file?.buffer?.length || !/\.pdf$/i.test(file.originalname || '') || file.buffer.subarray(0, 5).toString() !== '%PDF-') {
    throw createApiError(400, 'Choose a valid PDF report');
  }
  if (file.buffer.length > MAX_REPORT_PDF_BYTES) throw createApiError(413, 'PDF reports must be 10 MB or smaller');
  let pdf;
  try { pdf = await PDFDocument.load(file.buffer); } catch { throw createApiError(400, 'This PDF is unreadable or password protected'); }
  const pageCount = pdf.getPageCount();
  if (!pageCount || pageCount > 100) throw createApiError(400, 'Choose a PDF with 1 to 100 pages');
  return { fileName: reportFileName(file.originalname), size: file.buffer.length, pageCount,
    checksum: crypto.createHash('sha256').update(file.buffer).digest('hex'), data: file.buffer };
};

const xml = (value) => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export const eventReportDocx = async (report) => {
  const zip = new JSZip();
  const paragraphs = renderEventReportText(report).split('\n').map((line, index) => `<w:p><w:pPr><w:spacing w:after="100"/></w:pPr><w:r><w:rPr>${index === 0 ? '<w:b/><w:sz w:val="32"/>' : '<w:sz w:val="22"/>'}</w:rPr><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`).join('');
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="900" w:bottom="900" w:left="900" w:right="900"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};

export const completedReportPdf = async (report, { convert = convertLeadershipFileToPdf } = {}) => {
  if (report.status !== 'submitted') throw createApiError(409, 'Only submitted reports can be downloaded');
  const buffer = await convert({ fileName: 'event-report.docx', buffer: await eventReportDocx(report) });
  if (!report.photos?.length || report.photos.some((photo) => photo.url)) return buffer;
  const pdf = await PDFDocument.load(buffer);
  const data = await loadReportPhotoData(report);
  for (const [index, photo] of report.photos.entries()) {
    const bytes = Buffer.from(data[index], 'base64');
    const image = photo.contentType === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const page = pdf.addPage([612, 792]);
    const size = image.scaleToFit(540, 700);
    page.drawText(`Photo ${index + 1}`, { x: 36, y: 756, size: 12 });
    page.drawImage(image, { x: (612 - size.width) / 2, y: (742 - size.height) / 2, ...size });
  }
  return Buffer.from(await pdf.save());
};
