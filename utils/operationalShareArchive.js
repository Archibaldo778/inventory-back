import JSZip from 'jszip';

const safeArchiveName = (value, fallback = 'attachment.bin') => String(value || '')
  .replace(/[\\/\0\r\n]+/g, '_')
  .trim()
  .slice(0, 180) || fallback;

const uniqueName = (name, used) => {
  if (!used.has(name.toLowerCase())) return name;
  const extensionIndex = name.lastIndexOf('.');
  const base = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : '';
  let suffix = 2;
  while (used.has(`${base} (${suffix})${extension}`.toLowerCase())) suffix += 1;
  return `${base} (${suffix})${extension}`;
};

export const createOperationalShareArchive = async (attachments = []) => {
  const values = (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => Buffer.isBuffer(attachment?.buffer) && attachment.buffer.length > 0)
    .slice(0, 50);
  const totalBytes = values.reduce((total, attachment) => total + attachment.buffer.length, 0);
  if (!values.length) throw Object.assign(new Error('At least one share attachment is required'), { statusCode: 400 });
  if (totalBytes > 30 * 1024 * 1024) throw Object.assign(new Error('Share attachments exceed the 30 MB limit'), { statusCode: 413 });

  const archive = new JSZip();
  const used = new Set();
  values.forEach((attachment) => {
    const name = uniqueName(safeArchiveName(attachment.name), used);
    used.add(name.toLowerCase());
    archive.file(name, attachment.buffer);
  });
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
};
