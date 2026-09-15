import crypto from 'node:crypto';

const cleanHeader = (value, maxLength = 500) => String(value ?? '')
  .replace(/[\r\n]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

const encodedWord = (value) => `=?UTF-8?B?${Buffer.from(cleanHeader(value), 'utf8').toString('base64')}?=`;
const base64Lines = (value) => Buffer.from(value).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
const asciiFileName = (value) => cleanHeader(value, 180)
  .normalize('NFKD')
  .replace(/[^\x20-\x7E]+/g, '')
  .replace(/["\\]/g, '_') || 'attachment.bin';
const encodedFileName = (value) => encodeURIComponent(cleanHeader(value, 180)).replace(/['()*]/g, (character) => (
  `%${character.charCodeAt(0).toString(16).toUpperCase()}`
));

export const createEmlDraft = ({ subject, html = '', attachments = [] } = {}) => {
  const values = (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => Buffer.isBuffer(attachment?.buffer) && attachment.buffer.length > 0)
    .slice(0, 50);
  const totalBytes = values.reduce((total, attachment) => total + attachment.buffer.length, 0);
  if (!values.length) throw Object.assign(new Error('At least one email attachment is required'), { statusCode: 400 });
  if (totalBytes > 30 * 1024 * 1024) throw Object.assign(new Error('Email attachments exceed the 30 MB limit'), { statusCode: 413 });

  const boundary = `----=_OCCDecks_${crypto.randomBytes(12).toString('hex')}`;
  const lines = [
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    `Subject: ${encodedWord(subject || 'OCC Decks Leadership Files')}`,
    'To:',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(Buffer.from(String(html || ''), 'utf8')),
  ];

  values.forEach((attachment) => {
    const fileName = cleanHeader(attachment.name, 180) || 'attachment.bin';
    const fallbackName = asciiFileName(fileName);
    const encodedName = encodedFileName(fileName);
    lines.push(
      `--${boundary}`,
      `Content-Type: ${cleanHeader(attachment.contentType, 160) || 'application/octet-stream'}; name="${fallbackName}"; name*=UTF-8''${encodedName}`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
      '',
      base64Lines(attachment.buffer)
    );
  });
  lines.push(`--${boundary}--`, '');
  return Buffer.from(lines.join('\r\n'), 'utf8');
};

