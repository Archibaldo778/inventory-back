const idPattern = /^[a-f0-9]{24}$/i;
export const parseUniformAssembly = (raw) => {
  let choices;
  try { choices = JSON.parse(raw); } catch { throw new Error('Invalid set composition'); }
  if (!Array.isArray(choices) || choices.length < 1 || choices.length > 30
    || choices.some((entry) => !entry || !idPattern.test(entry.modelId || '') || typeof entry.colorId !== 'string' || entry.colorId.length > 80)) {
    throw new Error('Choose between 1 and 30 valid parts');
  }
  return choices.map(({ modelId, colorId }) => ({ modelId, colorId }));
};
export const resolveUniformAssembly = (choices, parts, templateKey) => {
  if (!templateKey) throw new Error('Choose a fitting template');
  const sections = new Set();
  const layers = choices.map((choice) => {
    const moved = parts.find((entry) => entry.previousSelections?.some((old) => old.modelId === choice.modelId && old.colorId === choice.colorId));
    const colorId = moved ? (moved.previousSelections.find((old) => String(old.modelId) === String(choice.modelId) && old.colorId === (choice.colorId || 'base'))?.targetColorId || 'base') : choice.colorId;
    const part = moved || parts.find((entry) => String(entry._id || entry.id) === choice.modelId);
    if (!part || part.assetType !== 'addon' || part.archivedAt || part.templateKey !== templateKey) throw new Error('A selected part is missing or uses a different fitting template');
    if (sections.has(part.category)) throw new Error('Choose only one model per section');
    sections.add(part.category);
    const color = colorId === 'base' ? { image: part.image, colorName: part.colorName, alternateImage: part.alternateImage } : (part.variants || []).find((entry) => entry.id === colorId);
    if (!color?.image) throw new Error('A selected color no longer exists');
    return { modelId: String(part._id || part.id), colorId, section: part.category, name: part.name,
      color: color.colorName || 'Original', image: color.image, ...(color.alternateImage ? { alternateImage: color.alternateImage } : {}), order: part.layerOrder ?? 10 };
  });
  if (!sections.has('Body')) throw new Error('Choose a Body layer');
  return layers.sort((a, b) => (a.section === 'Body' ? -1 : b.section === 'Body' ? 1 : a.order - b.order || a.section.localeCompare(b.section)));
};
