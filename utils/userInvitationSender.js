const clean = (value, max = 200) => String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const validEmail = (value) => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
const defaultMailbox = 'reports@reports.occdecks.com';

export const resolveAutomaticEmailSender = (from = process.env.USER_INVITE_FROM) => {
  const configured = clean(from, 320);
  const mailbox = (configured.match(/<([^<>]+)>$/)?.[1] || configured).trim();
  const replyTo = clean(process.env.AUTOMATED_EMAIL_REPLY_TO, 320).toLowerCase();
  return {
    name: 'OCC Decks',
    email: validEmail(replyTo) ? replyTo : 'staffing@ocnyc.com',
    from: `OCC Decks <${validEmail(mailbox) ? mailbox : defaultMailbox}>`,
  };
};

export const resolveUserInvitationSender = (source) => {
  const automatic = resolveAutomaticEmailSender();
  if (!source || !(source.username || source.name || source.email)) return automatic;

  const name = clean(source.username || source.name || source.email) || automatic.name;
  const email = clean(source.email, 320).toLowerCase();
  const mailbox = automatic.from.match(/<([^<>]+)>/)[1];
  const display = `${name} at OCC`;
  const quoted = `"${display.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return {
    name,
    email: validEmail(email) ? email : automatic.email,
    from: `${quoted} <${mailbox}>`,
  };
};
