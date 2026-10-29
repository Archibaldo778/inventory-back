export const uniformAccessoryFields = (body, current) => {
  const assetType = body.assetType ?? current?.assetType ?? 'set';
  if (!['set', 'addon'].includes(assetType)) throw new Error('Invalid uniform asset type');
  let compatibleSetIds = current?.compatibleSetIds || [];
  if (body.compatibleSetIds !== undefined) {
    try { compatibleSetIds = JSON.parse(body.compatibleSetIds); } catch { throw new Error('Invalid compatible sets'); }
    if (!Array.isArray(compatibleSetIds) || compatibleSetIds.length > 200 || compatibleSetIds.some((id) => typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))) throw new Error('Invalid compatible sets');
  }
  const templateKey = String(body.templateKey ?? current?.templateKey ?? '').trim();
  if (templateKey && !/^[a-z0-9-]{1,60}$/.test(templateKey)) throw new Error('Template must use lowercase letters, numbers and hyphens');
  const layerOrder = Number(body.layerOrder ?? current?.layerOrder ?? 10);
  if (!Number.isInteger(layerOrder) || layerOrder < 0 || layerOrder > 100) throw new Error('Layer order must be between 0 and 100');
  if (assetType === 'addon' && !compatibleSetIds.length && !templateKey) throw new Error('Select at least one compatible base set');
  return body.assetType === undefined && body.compatibleSetIds === undefined && body.layerOrder === undefined && body.templateKey === undefined
    ? {} : { ...(body.templateKey !== undefined ? { templateKey } : {}), assetType, compatibleSetIds: [...new Set(compatibleSetIds)], layerOrder };
};
