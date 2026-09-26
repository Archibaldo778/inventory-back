const clean = (value) => String(value ?? '').trim();

export const currentMessageInventoryCodes = (message) => [...new Set(
  (clean(message).match(/\bOCC\s*0*\d+\b/gi) || [])
    .map((value) => value.replace(/\s+/g, '').toUpperCase())
)];

export const isExplicitDecorAddCommand = (message) => {
  const value = clean(message);
  const addRequested = /(?:\badd\b|\bplace\b|добав|постав|закин)/i.test(value);
  const question = /\?|\b(?:why|how)\b|\b(?:почему|как)\b/i.test(value);
  return addRequested && !question;
};

export const selectAssistantDecorProduct = ({
  message,
  exactInventory = [],
  inventoryCandidates = [],
  modelSelectedProduct = null,
} = {}) => {
  const codes = currentMessageInventoryCodes(message);
  const exactProduct = codes.map((code) => (
    exactInventory.find((item) => clean(item?.inventoryCode).toUpperCase() === code)
  )).find(Boolean) || null;
  if (exactProduct) return { product: exactProduct, exactCurrentCode: true };
  if (modelSelectedProduct) return { product: modelSelectedProduct, exactCurrentCode: false };
  if (isExplicitDecorAddCommand(message) && inventoryCandidates.length === 1) {
    return { product: inventoryCandidates[0], exactCurrentCode: false };
  }
  return { product: null, exactCurrentCode: false };
};

export const assistantDecorActionKind = (exactCurrentCode) => (
  exactCurrentCode ? 'add_decor' : 'preview_add_decor'
);
