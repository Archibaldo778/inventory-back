const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const email = (value) => {
  const normalized = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
};
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

export const renderBarReturnEmail = (event = {}) => {
  const rows = (Array.isArray(event.items) ? event.items : []).filter((item) => item?.included !== false).map((item) => (
    `<tr><td>${escapeHtml(item.name)}</td><td>${Number(item.sentQty) || 0}</td><td>${Number(item.deliveredQty ?? item.sentQty) || 0}</td><td>${Number(item.returnedFullQty) || 0}</td><td>${Number(item.returnedOpenQty) || 0}</td><td>${Number(item.lostDamagedQty) || 0}</td></tr>`
  )).join('');
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#20272c"><h1>Bar Returns</h1><p><strong>${escapeHtml(event.name)}</strong> · ${escapeHtml(event.eventDate)}</p><p>Submitted by ${escapeHtml(event.submittedBy || event.guestIntake?.reporterName) || '—'}</p><table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse"><thead><tr><th>Item</th><th>Sent</th><th>Received</th><th>Full return</th><th>Open return</th><th>Lost / damaged</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
};

export const renderBarReturnText = (event = {}) => [
  `BAR RETURNS\n${clean(event.name)} · ${clean(event.eventDate)}\nSubmitted by ${clean(event.submittedBy || event.guestIntake?.reporterName) || '—'}`,
  ...(Array.isArray(event.items) ? event.items : []).filter((item) => item?.included !== false).map((item) => (
    `${clean(item.name)}: sent ${Number(item.sentQty) || 0}; received ${Number(item.deliveredQty ?? item.sentQty) || 0}; full return ${Number(item.returnedFullQty) || 0}; open return ${Number(item.returnedOpenQty) || 0}; lost/damaged ${Number(item.lostDamagedQty) || 0}`
  )),
].join('\n');

export const sendBarReturnEmail = async ({ event, captainEmail = '', fetchImpl = fetch }) => {
  const to = ['sam@ocnyc.com'];
  const reporterEmail = email(captainEmail);
  const cc = reporterEmail && !to.includes(reporterEmail) ? [reporterEmail] : [];
  const apiKey = clean(process.env.RESEND_API_KEY, 1000);
  if (!apiKey) return { status: 'failed', recipients: to, cc, error: 'RESEND_API_KEY is not configured' };
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: clean(process.env.BAR_RETURN_FROM, 320) || 'OCC Beverage <beverage@reports.occdecks.com>',
      to,
      ...(cc.length ? { cc } : {}),
      subject: `Bar Returns · ${clean(event?.name, 300)} · ${clean(event?.eventDate, 40)}`,
      html: renderBarReturnEmail(event),
      text: renderBarReturnText(event),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) return { status: 'failed', recipients: to, cc, error: clean(payload?.message || `Resend HTTP ${response.status}`, 1000) };
  return { status: 'sent', providerId: clean(payload.id, 200), sentAt: new Date(), recipients: to, cc, error: '' };
};
