const clean = (value, max = 200) => String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const validEmail = (value) => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
const defaultFrom = 'Ivan at OCC <reports@reports.occdecks.com>';

export const resolveUserInvitationSender = (source) => {
  const configuredFrom = clean(process.env.USER_INVITE_FROM, 320) || defaultFrom;
  const fallbackEmail = clean(process.env.USER_INVITE_REPLY_TO, 320) || 'ivan@ocnyc.com';
  const legacy = { name: 'Ivan', email: fallbackEmail, from: configuredFrom };
  if (!source || !(source.username || source.name || source.email)) return legacy;

  const name = clean(source.username || source.name || source.email) || legacy.name;
  const email = clean(source.email, 320).toLowerCase();
  const configuredMailbox = (configuredFrom.match(/<([^<>]+)>$/)?.[1] || configuredFrom).trim();
  const mailbox = validEmail(configuredMailbox) ? configuredMailbox : defaultFrom.match(/<([^<>]+)>/)[1];
  const display = `${name} at OCC`;
  const quoted = `"${display.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return {
    name,
    email: validEmail(email) ? email : fallbackEmail,
    from: `${quoted} <${mailbox}>`,
  };
};
