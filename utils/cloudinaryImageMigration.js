export const classifyKitchenImage = (value) => {
  const source = String(value || '').trim();
  if (!source) return 'empty';
  if (/^https?:\/\/res\.cloudinary\.com\//i.test(source)) {
    if (/\/inventory\/kitchen\//i.test(source)) return 'cloudinary_legacy_folder';
    if (/\/kitchen\//i.test(source)) return 'cloudinary_target_folder';
    return 'cloudinary_other';
  }
  if (/^\/?uploads\//i.test(source) || /\/uploads\//i.test(source)) return 'local_uploads';
  return 'other';
};

export const extractCloudinaryPublicId = (value) => {
  try {
    const parsed = new URL(String(value || ''));
    if (!/^res\.cloudinary\.com$/i.test(parsed.hostname)) return '';
    const marker = '/upload/';
    const uploadIndex = parsed.pathname.indexOf(marker);
    if (uploadIndex < 0) return '';

    const parts = parsed.pathname
      .slice(uploadIndex + marker.length)
      .split('/')
      .filter(Boolean);
    const versionIndex = parts.findIndex((part) => /^v\d+$/.test(part));
    const publicPath = parts.slice(versionIndex >= 0 ? versionIndex + 1 : 0);
    if (publicPath.length === 0) return '';

    const lastIndex = publicPath.length - 1;
    publicPath[lastIndex] = publicPath[lastIndex].replace(/\.[a-z0-9]{2,5}$/i, '');
    return publicPath.join('/');
  } catch {
    return '';
  }
};

export const getKitchenTargetPublicId = (oldPublicId) => {
  const value = String(oldPublicId || '').trim();
  if (!value.startsWith('inventory/kitchen/')) return '';
  const suffix = value.slice('inventory/kitchen/'.length);
  return suffix ? `kitchen/${suffix}` : '';
};
