import { isRoleOwner } from './roleOwners.js';

// Verified office accounts; names and role labels do not grant this capability.
const DOCUMENT_TEAM_IDS = new Set(['69a6f1a54c4a3e64a3a30791', '6a872f39abf315bf3051bc76']);
export const canTeachDocumentAi = (auth) => isRoleOwner(auth)
  || DOCUMENT_TEAM_IDS.has(String(auth?.userId || auth?._id || '').toLowerCase());
export const requireDocumentTeacher = (req, res, next) => canTeachDocumentAi(req.auth)
  ? next() : res.status(403).json({ message: 'Document AI access is restricted to the authorized office accounts' });
