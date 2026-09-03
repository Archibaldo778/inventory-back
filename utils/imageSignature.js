const startsWithBytes = (buffer, signature) => (
  Buffer.isBuffer(buffer)
  && buffer.length >= signature.length
  && signature.every((byte, index) => buffer[index] === byte)
);

const asciiAt = (buffer, offset, value) => (
  Buffer.isBuffer(buffer)
  && buffer.length >= offset + value.length
  && buffer.toString('ascii', offset, offset + value.length) === value
);

export const detectImageType = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (asciiAt(buffer, 0, 'GIF87a') || asciiAt(buffer, 0, 'GIF89a')) return 'gif';
  if (asciiAt(buffer, 0, 'BM')) return 'bmp';
  if (startsWithBytes(buffer, [0x49, 0x49, 0x2a, 0x00]) || startsWithBytes(buffer, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (asciiAt(buffer, 0, 'RIFF') && asciiAt(buffer, 8, 'WEBP')) return 'webp';

  if (asciiAt(buffer, 4, 'ftyp')) {
    const brandWindow = buffer.toString('ascii', 8, Math.min(buffer.length, 40)).toLowerCase();
    const heifBrands = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];
    if (heifBrands.some((brand) => brandWindow.includes(brand))) return 'heif';
  }
  return '';
};

export const detectPackoutDocumentType = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return '';
  if (asciiAt(buffer, 0, '%PDF-')) return 'pdf';
  return detectImageType(buffer);
};

export const isAllowedPackoutDocumentUpload = (file) => (
  Boolean(detectPackoutDocumentType(file?.buffer))
);

export const isAllowedImageUpload = (file, allowedTypes = []) => {
  if (!file?.buffer) return false;
  const detected = detectImageType(file.buffer);
  const allowed = new Set(allowedTypes);
  return Boolean(detected && allowed.has(detected));
};

export const INVALID_IMAGE_UPLOAD_RESPONSE = Object.freeze({
  error: 'Uploaded file content is not a supported image',
  code: 'INVALID_IMAGE_SIGNATURE',
});

export const INVALID_PACKOUT_UPLOAD_RESPONSE = Object.freeze({
  message: 'Uploaded file content is not a supported PDF or image',
  code: 'INVALID_PACKOUT_FILE_SIGNATURE',
});
