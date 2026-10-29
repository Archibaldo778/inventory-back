export const uniformAccessoryFields = (body, current) => {
  const assetType = body.assetType ?? current?.assetType ?? 'set';
  if (!['set', 'addon'].includes(assetType)) throw new Error('Invalid uniform asset type');
  let compatibleSetIds = current?.compatibleSetIds || [];
  if (body.compatibleSetIds !== undefined) {
    try { compatibleSetIds = JSON.parse(body.compatibleSetIds); } catch { throw new Error('Invalid compatible sets'); }
    if (!Array.isArray(compatibleSetIds) || compatibleSetIds.length > 200 || compatibleSetIds.some((id) => typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))) throw new Error('Invalid compatible sets');
  }
  const layerOrder = Number(body.layerOrder ?? current?.layerOrder ?? 10);
  if (!Number.isInteger(layerOrder) || layerOrder < 0 || layerOrder > 100) throw new Error('Layer order must be between 0 and 100');
  if (assetType === 'addon' && !compatibleSetIds.length) throw new Error('Select at least one compatible base set');
  return body.assetType === undefined && body.compatibleSetIds === undefined && body.layerOrder === undefined
    ? {} : { assetType, compatibleSetIds: [...new Set(compatibleSetIds)], layerOrder };
};
