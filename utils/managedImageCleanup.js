import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.resolve(__dirname, '..', 'uploads');
const LOCAL_UPLOAD_PATH = /^\/uploads\/(decor|kitchen|beverage|board)\/([a-z0-9._-]+)$/i;

const toUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw, 'https://local.invalid');
  } catch {
    return null;
  }
};

const resolveLocalUpload = (value) => {
  const parsed = toUrl(value);
  if (!parsed) return '';
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return '';
  }
  const match = pathname.match(LOCAL_UPLOAD_PATH);
  if (!match) return '';
  const target = path.resolve(uploadsRoot, match[1], match[2]);
  return target.startsWith(`${uploadsRoot}${path.sep}`) ? target : '';
};

const resolveCloudinaryPublicId = (value) => {
  const parsed = toUrl(value);
  if (!parsed || parsed.hostname.toLowerCase() !== 'res.cloudinary.com') return '';
  const segments = parsed.pathname.split('/').filter(Boolean);
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  if (cloudName && segments[0] !== cloudName) return '';

  const uploadIndex = segments.indexOf('upload');
  if (uploadIndex < 0) return '';
  const versionIndex = segments.findIndex(
    (segment, index) => index > uploadIndex && /^v\d+$/.test(segment)
  );
  if (versionIndex < 0 || versionIndex >= segments.length - 1) return '';

  let publicId;
  try {
    publicId = segments.slice(versionIndex + 1).map(decodeURIComponent).join('/');
  } catch {
    return '';
  }
  return publicId.replace(/\.[a-z0-9]+$/i, '');
};

export const cleanupManagedImage = async (value) => {
  const localPath = resolveLocalUpload(value);
  if (localPath) {
    try {
      await fs.unlink(localPath);
      return { removed: true, kind: 'local' };
    } catch (error) {
      if (error?.code === 'ENOENT') return { removed: false, kind: 'local' };
      throw error;
    }
  }

  const publicId = resolveCloudinaryPublicId(value);
  if (publicId) {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      invalidate: true,
    });
    return {
      removed: result?.result === 'ok',
      kind: 'cloudinary',
      publicId,
    };
  }

  return { removed: false, kind: 'external' };
};

export const cleanupManagedImageSafely = async (value, context = 'image') => {
  try {
    return await cleanupManagedImage(value);
  } catch (error) {
    console.error(`Failed to clean up managed ${context}:`, error?.message || error);
    return { removed: false, kind: 'error' };
  }
};
