import { wardrobeColorFields } from './uniformWardrobeColors.js';

const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
export const uniformStyleMove = ({ source, target, colorId, targetColorId, name, category, fields = {} }) => {
  if (!source || source.assetType !== 'addon' || source.archivedAt) fail('Model not found', 404);
  const original = colorId === 'base' ? (source.baseArchived ? null : source) : source.variants?.find((entry) => entry.id === colorId);
  if (!original) fail('Color not found', 404);
  if (target && (target.archivedAt || target.assetType !== 'addon' || target.category !== source.category || target.templateKey !== source.templateKey)) fail('Choose a style in the same category and fitting template');
  if (target && String(target._id) === String(source._id)) fail('Choose a different style');
  const color = { ...wardrobeColorFields({ colorName: original.colorName, swatch: original.swatch, ...fields }), image: fields.image || original.image, alternateImage: fields.alternateImage || original.alternateImage };
  if (target && [...(target.baseArchived ? [] : [target]), ...(target.variants || [])].some((entry) => String(entry.colorName).trim().toLowerCase() === color.colorKey)) fail('That style already has this color. Choose another style or color name.', 409);
  if (!target && (!name?.trim() || name.trim().length > 120 || !category?.trim() || category.length > 60 || category === 'Body')) fail('Enter a style name and clothing category');
  const destinationColorId = target ? targetColorId : 'base';
  const aliases = [...(source.previousSelections || []).filter((entry) => (entry.targetColorId || 'base') === colorId), { modelId: String(source._id), colorId }].map((entry) => ({ ...entry, targetColorId: destinationColorId }));
  const sourceUpdate = { previousSelections: (source.previousSelections || []).filter((entry) => (entry.targetColorId || 'base') !== colorId) };
  if (colorId === 'base') {
    sourceUpdate.baseArchived = true;
    if (!source.variants?.length) sourceUpdate.archivedAt = new Date();
  } else {
    sourceUpdate.variants = source.variants.filter((entry) => entry.id !== colorId);
    if (source.baseArchived && !sourceUpdate.variants.length) sourceUpdate.archivedAt = new Date();
  }
  const destination = target ? { variants: [...(target.variants || []), { ...color, id: destinationColorId }], previousSelections: [...(target.previousSelections || []), ...aliases] } : {
    name: name.trim(), category: category.trim(), assetType: 'addon', templateKey: source.templateKey,
    layerOrder: source.layerOrder, image: color.image, alternateImage: color.alternateImage,
    colorName: color.colorName, swatch: color.swatch, previousSelections: aliases,
  };
  return { sourceUpdate, destination };
};
