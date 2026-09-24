import Event from '../models/Event.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import {
  createSlackPrivateChannel,
  inviteSlackUsers,
  listSlackChannels,
  listSlackUsers,
  pinSlackMessage,
  postSlackMessage,
  slackAuthTest,
} from './slackApi.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const clean = (value) => String(value || '').trim();
export const slackEventChannelsEnabled = () => /^(?:1|true|yes|on)$/i.test(clean(process.env.SLACK_EVENT_CHANNELS_ENABLED));
const normalize = (value) => clean(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

export const slackEventChannelName = (event = {}) => {
  const date = clean(event.date).match(/^\d{4}-(\d{2})-(\d{2})$/);
  const prefix = date ? `${date[1]}${date[2]}` : 'event';
  const title = normalize(event.title).replace(/\s+/g, '-').slice(0, 48).replace(/-+$/g, '') || 'event';
  const eventNumber = normalize(event.externalId).replace(/\s+/g, '-').slice(-16);
  return [prefix, title, eventNumber].filter(Boolean).join('-').slice(0, 80).replace(/-+$/g, '');
};

const slackUserIndexes = (users = []) => {
  const byEmail = new Map();
  const byName = new Map();
  users.forEach((user) => {
    if (user?.deleted || user?.is_bot || user?.id === 'USLACKBOT') return;
    const email = clean(user?.profile?.email).toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, user);
    [user?.profile?.real_name_normalized, user?.profile?.real_name, user?.real_name, user?.name]
      .map(normalize)
      .filter(Boolean)
      .forEach((name) => {
        const current = byName.get(name) || [];
        current.push(user);
        byName.set(name, current);
      });
  });
  return { byEmail, byName };
};

export const matchSlackEventWorkers = ({ schedule, slackUsers }) => {
  const { byEmail, byName } = slackUserIndexes(slackUsers);
  const matched = new Map();
  const unmatched = new Map();
  (Array.isArray(schedule?.shifts) ? schedule.shifts : []).forEach((shift) => {
    (Array.isArray(shift?.workers) ? shift.workers : []).forEach((worker) => {
      const status = clean(worker?.status).toLowerCase();
      if (status && !['assigned', 'confirmed'].includes(status)) return;
      const email = clean(worker?.email).toLowerCase();
      const name = clean(worker?.name);
      const emailMatch = email ? byEmail.get(email) : null;
      const nameMatches = byName.get(normalize(name)) || [];
      const match = emailMatch || (nameMatches.length === 1 ? nameMatches[0] : null);
      if (match?.id) matched.set(match.id, { id: match.id, name, email });
      else if (name || email) unmatched.set(`${normalize(name)}:${email}`, { name, email });
    });
  });
  return { matched: [...matched.values()], unmatched: [...unmatched.values()] };
};

const frontendBaseUrl = () => clean(
  process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || process.env.CLIENT_URL || process.env.APP_URL || 'https://ocdecks.com'
).replace(/\/+$/g, '');

const eventUrl = (event) => `${frontendBaseUrl()}/events/${encodeURIComponent(String(event._id))}`;

const eventMessage = (event, schedule) => {
  const url = eventUrl(event);
  const time = [schedule?.shifts?.[0]?.startTime, schedule?.shifts?.at(-1)?.endTime].filter(Boolean).join(' – ');
  const details = [clean(event.date), time, clean(schedule?.venue || event?.meta?.venue)].filter(Boolean).join(' · ');
  return {
    text: `${event.title} — event workspace: ${url}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: clean(event.title).slice(0, 150), emoji: true } },
      ...(details ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: details }] }] : []),
      { type: 'section', text: { type: 'mrkdwn', text: 'Open the event workspace for current KM, PO, KPO, Staff Request, boards, and operational updates.' } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open event files' }, url, action_id: 'open_event_files' }] },
    ],
  };
};

const findEventForSchedule = async (schedule) => Event.findOne({
  $or: [
    { 'meta.nowsta.apiEventId': clean(schedule.nowstaEventId) },
    ...(clean(schedule.externalId) ? [{ externalId: clean(schedule.externalId) }] : []),
  ],
}).lean();

let activeSlackSync = null;

export const runSlackEventChannelSync = async ({ now = new Date() } = {}) => {
  if (activeSlackSync) return activeSlackSync;
  activeSlackSync = (async () => {
    if (!clean(process.env.SLACK_BOT_TOKEN)) return { configured: false, processed: 0, created: 0, updated: 0, skipped: 0 };
    if (!slackEventChannelsEnabled()) return { configured: true, enabled: false, processed: 0, created: 0, updated: 0, skipped: 0 };
    const from = new Date(now.getTime() - DAY_MS);
    const through = new Date(now.getTime() + DAY_MS);
    const schedules = await NowstaScheduleEntry.find({
      entryType: 'event',
      archived: false,
      startsAt: { $gt: from, $lte: through },
    }).sort({ startsAt: 1 }).lean();
    if (!schedules.length) return { configured: true, enabled: true, processed: 0, created: 0, updated: 0, skipped: 0 };

    const [auth, slackUsers, slackChannels] = await Promise.all([
      slackAuthTest(),
      listSlackUsers(),
      listSlackChannels(),
    ]);
    const channelsByName = new Map(slackChannels.map((channel) => [clean(channel?.name), channel]));
    const summary = { configured: true, enabled: true, team: clean(auth?.team), processed: 0, created: 0, updated: 0, skipped: 0, unmatched: 0 };

    for (const schedule of schedules) {
      const event = await findEventForSchedule(schedule);
      if (!event) {
        summary.skipped += 1;
        continue;
      }
      const stored = event?.meta?.slack && typeof event.meta.slack === 'object' ? event.meta.slack : {};
      const channelName = clean(stored.channelName) || slackEventChannelName(event);
      let channel = clean(stored.channelId) ? { id: clean(stored.channelId), name: channelName } : channelsByName.get(channelName);
      let created = false;
      if (!channel?.id) {
        channel = await createSlackPrivateChannel(channelName);
        channelsByName.set(channelName, channel);
        created = true;
      }

      const workers = matchSlackEventWorkers({ schedule, slackUsers });
      const previouslyInvited = new Set(Array.isArray(stored.invitedUserIds) ? stored.invitedUserIds.map(clean) : []);
      const inviteIds = workers.matched.map((worker) => worker.id).filter((id) => !previouslyInvited.has(id));
      if (inviteIds.length) await inviteSlackUsers(channel.id, inviteIds);

      let messageTs = clean(stored.messageTs);
      if (!messageTs) {
        const posted = await postSlackMessage({ channel: channel.id, ...eventMessage(event, schedule) });
        messageTs = clean(posted?.ts);
        if (messageTs) await pinSlackMessage(channel.id, messageTs);
      }
      const invitedUserIds = [...new Set([...previouslyInvited, ...workers.matched.map((worker) => worker.id)])];
      await Event.updateOne({ _id: event._id }, { $set: {
        'meta.slack': {
          channelId: clean(channel.id),
          channelName: clean(channel.name) || channelName,
          channelUrl: `https://slack.com/app_redirect?channel=${encodeURIComponent(clean(channel.id))}`,
          messageTs,
          invitedUserIds,
          unmatchedWorkers: workers.unmatched,
          createdAt: stored.createdAt || new Date(),
          lastSyncedAt: new Date(),
        },
      } });
      summary.processed += 1;
      summary.unmatched += workers.unmatched.length;
      if (created) summary.created += 1;
      else summary.updated += 1;
    }
    return summary;
  })();
  try {
    return await activeSlackSync;
  } finally {
    activeSlackSync = null;
  }
};
