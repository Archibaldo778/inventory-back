import crypto from 'node:crypto';
import { downloadDropboxFile } from './dropboxApi.js';

export function dropboxContentHash(buffer) {
  const hash = crypto.createHash('sha256');
  for (let offset = 0; offset < buffer.length; offset += 4 * 1024 * 1024) {
    hash.update(crypto.createHash('sha256').update(buffer.subarray(offset, offset + 4 * 1024 * 1024)).digest());
  }
  return hash.digest('hex');
}

// Read the exact attached revision, including retained content after a move/deletion.
// Never restore files or search outside the event's known source documents.
export async function downloadDropboxDocumentSnapshot(token, document, namespaceId, download = downloadDropboxFile) {
  const revision = String(document.sourceRevision || '');
  if (!/^[a-f0-9]{9,}$/i.test(revision) || !/^[a-f0-9]{64}$/i.test(document.checksum || '')) {
    throw new Error('Source revision or checksum is missing; document needs review');
  }
  const buffer = await download(token, `rev:${revision}`, { namespaceId });
  if (dropboxContentHash(buffer) !== document.checksum) throw new Error('Downloaded source does not match the attached document checksum');
  return buffer;
}
