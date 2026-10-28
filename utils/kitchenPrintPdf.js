export const decodeKitchenPrintPdf = (value) => {
  if (!Buffer.isBuffer(value) && (typeof value !== 'string' || !value.length || value.length > 12 * 1024 * 1024
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))) {
    throw Object.assign(new Error('Kitchen print references are missing or too large. Please retry.'), { statusCode: 400 });
  }
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'base64');
  if (buffer.subarray(0, 5).toString() !== '%PDF-') {
    throw Object.assign(new Error('Kitchen print references must be a PDF.'), { statusCode: 400 });
  }
  return buffer;
};
