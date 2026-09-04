export const MAX_PRODUCT_IMAGES = 8;

export const normalizeProductImages = (product, additional = []) => {
  const candidates = [
    product?.image,
    product?.imageUrl,
    ...(Array.isArray(product?.images) ? product.images : []),
    ...(Array.isArray(additional) ? additional : []),
  ];
  const seen = new Set();
  return candidates.reduce((result, value) => {
    const url = String(value || '').trim();
    if (!url || seen.has(url)) return result;
    seen.add(url);
    result.push(url);
    return result;
  }, []).slice(0, MAX_PRODUCT_IMAGES);
};
