import { fetchWithTimeout, readBoundedResponseBuffer } from './fetchWithTimeout.js';

let brandLogoSvgPromise = null;

export const loadBrandLogoSvg = () => {
  if (brandLogoSvgPromise) return brandLogoSvgPromise;
  brandLogoSvgPromise = (async () => {
    try {
      const appOrigin = String(process.env.PUBLIC_APP_ORIGIN || process.env.FRONTEND_URL || 'https://occdecks.com').replace(/\/+$/, '');
      const response = await fetchWithTimeout(`${appOrigin}/mockups/oc-logo.svg`, { headers: { Accept: 'image/svg+xml' } }, { timeoutMs: 5000 });
      if (!response.ok) return null;
      const { buffer } = await readBoundedResponseBuffer(response, {
        maxBytes: 200_000,
        allowedContentTypes: ['image/svg+xml'],
      });
      return buffer.toString('utf8', 0, Math.min(buffer.length, 300)).includes('<svg') ? buffer : null;
    } catch {
      return null;
    }
  })();
  return brandLogoSvgPromise;
};

export const cloudinaryWordThumbnailUrl = (value) => {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') return '';
    url.pathname = url.pathname.replace('/upload/', '/upload/f_jpg,c_pad,b_white,w_180,h_180,q_auto/');
    return url.toString();
  } catch {
    return '';
  }
};

export const loadCloudinaryWordImages = async (entries = []) => {
  const requested = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({ itemName: String(entry?.itemName || '').trim(), url: cloudinaryWordThumbnailUrl(entry?.url) }))
    .filter((entry) => entry.itemName && entry.url)
    .slice(0, 40);
  const images = [];
  for (let offset = 0; offset < requested.length; offset += 5) {
    const batch = await Promise.all(requested.slice(offset, offset + 5).map(async (entry) => {
      try {
        const response = await fetchWithTimeout(entry.url, { headers: { Accept: 'image/jpeg' } }, { timeoutMs: 7000 });
        if (!response.ok) return null;
        const { buffer } = await readBoundedResponseBuffer(response, {
          maxBytes: 2 * 1024 * 1024,
          allowedContentTypes: ['image/jpeg', 'image/jpg'],
        });
        return { itemName: entry.itemName, buffer, extension: 'jpg', contentType: 'image/jpeg' };
      } catch {
        return null;
      }
    }));
    images.push(...batch.filter(Boolean));
  }
  return images;
};
