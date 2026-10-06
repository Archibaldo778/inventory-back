// Verified administrative account IDs. Captain accounts are separate identities.
const OWNER_IDS = new Set(['68c70548aea053de74d25b22', '68c7047faea053de74d25b15']);
export const isRoleOwner = (user) => OWNER_IDS.has(String(user?.userId || user?._id || user?.id || '').trim().toLowerCase());

export const protectedAccountChange = (target, changes = {}, actor) => {
  if (!isRoleOwner(target)) return '';
  if (!isRoleOwner(actor)) return 'Only role owners can manage this protected account';
  if (['false', '0', 'no', 'off'].includes(String(changes.isActive ?? changes.active).trim().toLowerCase())) return 'Role owner accounts must remain active';
  if (changes.role !== undefined && changes.role !== target.role) return 'Role owner access cannot be changed';
  if (changes.jobTitle !== undefined && String(changes.jobTitle || '') !== String(target.jobTitle || '')) return 'Role owner access cannot be changed';
  return '';
};
