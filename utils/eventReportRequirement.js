// These operational event names do not require a captain or kitchen report.
const EXEMPT_EVENT_NAME = /\b(?:tastings?|walk\s*(?:through|thru|throug)|load\s*(?:in|out))\b/i;

export const requiresEventReport = (...events) => !events.some((event) => (
  [event?.title, event?.name].some((value) => EXEMPT_EVENT_NAME.test(
    String(value || '').normalize('NFKC').replace(/[^a-z0-9]+/gi, ' ').trim(),
  ))
));
