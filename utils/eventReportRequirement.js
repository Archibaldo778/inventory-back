import { isRoleOwner } from './roleOwners.js';

// These operational event names do not require a captain or kitchen report.
const EXEMPT_EVENT_NAME = /\b(?:tastings?|walk\s*(?:through|thru|throug)|load\s*(?:in|out)|rentals?\s*check\s*in)\b/i;

export const requiresEventReport = (...events) => !events.some((event) => (
  [event?.title, event?.name].some((value) => EXEMPT_EVENT_NAME.test(
    String(value || '').normalize('NFKC').replace(/[^a-z0-9]+/gi, ' ').trim(),
  ))
));

export const requiresCaptainReport = (...events) => requiresEventReport(...events)
  && !events.some((event) => event?.meta?.captainReportDisabled === true);

export const requiresReportType = (type, ...events) => type === 'kitchen'
  ? requiresEventReport(...events) : requiresCaptainReport(...events);

export const canManageCaptainReportRequirement = (auth) => isRoleOwner(auth)
  || ['kitchen admin', 'staffing admin'].includes(String(auth?.role || '').trim().toLowerCase());
