import Event from '../models/Event.js';
import Staff from '../models/Staff.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import EventReport from '../models/EventReport.js';
import {
  createSlackPrivateChannel,
  inviteSlackUsers,
  listSlackChannels,
  listSlackUserGroups,
  listSlackUsers,
  pinSlackMessage,
  postSlackMessage,
  removeSlackUserFromChannel,
  renameSlackChannel,
  slackAuthTest,
  unarchiveSlackChannel,
  updateSlackMessage,
} from './slackApi.js';
import { issueEventGuestAccess } from './eventGuestAccess.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_REPORT_REMINDER_MS = 2 * 60 * 1000;
const clean = (value) => String(value || '').trim();
const DEFAULT_EVENT_LEADERSHIP_TEAMS = [
  { managers: ['Olivier Cheng', 'Oliver Cheng'], slackGroupLabel: 'teamOC', slackGroupNames: ['teamOC', 'Team OC'], assistants: ['Ashley', 'Sebastian', 'Heidi'] },
  { managers: ['George'], slackGroupLabel: 'team George', slackGroupNames: ['team George', 'teamGeorge'], assistants: ['Megan'] },
  { managers: ['Guillaume'], slackGroupLabel: 'team Guillaume', slackGroupNames: ['team Guillaume', 'teamGuillaume', 'Guillaume'], assistants: [] },
  { managers: ['Emma'], slackGroupNames: [], assistants: [] },
];
const ALWAYS_INCLUDED_SLACK_GROUPS = [{ label: 'Leadership Team', names: ['Leadership Team', 'leadershipTeam'] }];
const ALWAYS_EVENT_CHANNEL_ADMINS = ['Ivan Vyskrebentsev', 'Iurie Scurtul', 'Chris Olson'];
const EVENT_LEADERSHIP_POSITION = /(?:captain|floor\s+lead|lead\s+chef|ma[iî]tre(?:\s*['’]?\s*d)?|driver)/i;
export const slackEventChannelsEnabled = () => /^(?:1|true|yes|on)$/i.test(clean(process.env.SLACK_EVENT_CHANNELS_ENABLED));
export const slackEventReportsEnabled = () => /^(?:1|true|yes|on)$/i.test(clean(process.env.SLACK_EVENT_REPORTS_ENABLED));
export const slackEventReportsEnabledForEvent = (event = {}) => (
  slackEventReportsEnabled() || event?.meta?.eventReportTest === true
);
export const eventReportReminderDelayMs = (event = {}) => (
  event?.meta?.eventReportTest === true ? TEST_REPORT_REMINDER_MS : DAY_MS
);
const normalize = (value) => clean(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const canonicalFirstName = (value) => {
  const name = normalize(value);
  return ['zak', 'zach', 'zack'].includes(name) ? 'zak' : name;
};

export const slackEventSeriesTitle = (value) => clean(value)
  .replace(/^\s*(?:20\d{2}[-/.])?\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?\s*[-–—:]?\s*/i, '')
  .replace(/^\s*setup\s*(?:day)?\s*[-–—:]?\s*/i, '')
  .replace(/\s*[-–—:,]?\s*setup\s*(?:day)?\s*$/i, '')
  .replace(/\s*[-–—:,]?\s*day\s*#?\s*\d+\s*$/i, '')
  .replace(/\s+/g, ' ')
  .trim();

export const slackEventSeriesKey = (value) => normalize(slackEventSeriesTitle(value));

const isoDateMs = (value) => {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN;
};

export const slackScheduleSeries = (targetSchedule, schedules = []) => {
  const targetKey = slackEventSeriesKey(targetSchedule?.title);
  const targetDateMs = isoDateMs(targetSchedule?.date);
  if (!targetKey || !Number.isFinite(targetDateMs)) return [targetSchedule].filter(Boolean);
  const candidates = (Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => slackEventSeriesKey(schedule?.title) === targetKey && Number.isFinite(isoDateMs(schedule?.date)))
    .sort((left, right) => isoDateMs(left.date) - isoDateMs(right.date));
  const targetIndex = candidates.findIndex((schedule) => (
    clean(schedule?._id) && clean(schedule?._id) === clean(targetSchedule?._id)
  ) || (
    clean(schedule?.nowstaEventId) && clean(schedule?.nowstaEventId) === clean(targetSchedule?.nowstaEventId)
  ));
  if (targetIndex < 0) return [targetSchedule];
  let first = targetIndex;
  let last = targetIndex;
  while (first > 0 && isoDateMs(candidates[first].date) - isoDateMs(candidates[first - 1].date) <= 7 * DAY_MS) first -= 1;
  while (last < candidates.length - 1 && isoDateMs(candidates[last + 1].date) - isoDateMs(candidates[last].date) <= 7 * DAY_MS) last += 1;
  return candidates.slice(first, last + 1);
};

export const slackEventChannelName = (event = {}, { startDate = '', title = '' } = {}) => {
  const date = clean(startDate || event.date).match(/^\d{4}-(\d{2})-(\d{2})$/);
  const prefix = date ? `${date[1]}-${date[2]}` : 'event';
  const channelTitle = normalize(slackEventSeriesTitle(title || event.title)).replace(/\s+/g, '-').slice(0, 64).replace(/-+$/g, '') || 'event';
  return `${prefix}-${channelTitle}`.slice(0, 80).replace(/-+$/g, '');
};

const slackUserIndexes = (users = []) => {
  const byEmail = new Map();
  const byName = new Map();
  const byFirstName = new Map();
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
        const firstName = canonicalFirstName(name.split(' ')[0]);
        const firstNameMatches = byFirstName.get(firstName) || [];
        if (!firstNameMatches.some((item) => item.id === user.id)) firstNameMatches.push(user);
        byFirstName.set(firstName, firstNameMatches);
      });
  });
  return { byEmail, byName, byFirstName };
};

const matchSlackPeople = ({ people = [], slackUsers = [], linkedSlackByNowstaId = new Map() }) => {
  const { byEmail, byName, byFirstName } = slackUserIndexes(slackUsers);
  const matched = new Map();
  const unmatched = new Map();
  people.forEach((person) => {
    const email = clean(person?.email).toLowerCase();
    const name = clean(person?.name);
    const normalizedName = normalize(name);
    const linkedSlackId = linkedSlackByNowstaId.get(clean(person?.companyUserId));
    const exactNameMatches = byName.get(normalizedName) || [];
    const firstNameMatches = normalizedName && !normalizedName.includes(' ')
      ? (byFirstName.get(canonicalFirstName(normalizedName)) || [])
      : [];
    const match = (linkedSlackId ? slackUsers.find((user) => clean(user?.id) === linkedSlackId) : null)
      || (email ? byEmail.get(email) : null)
      || (exactNameMatches.length === 1 ? exactNameMatches[0] : null)
      || (firstNameMatches.length === 1 ? firstNameMatches[0] : null);
    if (match?.id) matched.set(match.id, { ...person, id: match.id, name, email });
    else if (name || email) unmatched.set(`${normalizedName}:${email}`, { name, email });
  });
  return { matched: [...matched.values()], unmatched: [...unmatched.values()] };
};

const eventManagerName = (event = {}) => clean(
  event.managerId
  || event.salesRep
  || event.salesRepName
  || event.managerName
  || event?.catereaseOperations?.salesRep
  || event?.catereaseOperations?.snapshot?.salesRep
  || event?.meta?.salesRep
  || event?.meta?.catereaseOperations?.salesRep
  || event?.meta?.catereaseSnapshot?.salesRep
  || event?.meta?.caterease?.salesRep
  || event?.meta?.calendar?.salesRep
  || event?.meta?.managerName
  || event?.meta?.salesRepName
  || event?.meta?.manager
  || event?.meta?.sales
);

export const eventLeadershipPeople = (event = {}) => {
  const managerName = eventManagerName(event);
  if (!managerName) return [];
  const normalizedManager = normalize(managerName);
  const team = DEFAULT_EVENT_LEADERSHIP_TEAMS.find(({ managers }) => managers.some((candidate) => {
    const normalizedCandidate = normalize(candidate);
    return normalizedManager === normalizedCandidate
      || normalizedManager.startsWith(`${normalizedCandidate} `)
      || normalizedCandidate.startsWith(`${normalizedManager} `);
  }));
  return [managerName, ...(team?.assistants || [])].map((name) => ({ name }));
};

export const eventChannelAdminPeople = (event = {}) => (
  event?.meta?.eventReportTest === true ? [] : ALWAYS_EVENT_CHANNEL_ADMINS.map((name) => ({ name }))
);

const eventLeadershipTeam = (event = {}) => {
  const normalizedManager = normalize(eventManagerName(event));
  return DEFAULT_EVENT_LEADERSHIP_TEAMS.find(({ managers }) => managers.some((candidate) => {
    const normalizedCandidate = normalize(candidate);
    return normalizedManager === normalizedCandidate
      || normalizedManager.startsWith(`${normalizedCandidate} `)
      || normalizedCandidate.startsWith(`${normalizedManager} `);
  })) || null;
};

export const slackEventUserGroupMembers = ({ event, userGroups = [] }) => {
  const leadershipTeam = eventLeadershipTeam(event);
  const requestedGroups = [
    ...ALWAYS_INCLUDED_SLACK_GROUPS,
    ...(leadershipTeam?.slackGroupNames?.length ? [{
      label: leadershipTeam.slackGroupLabel || leadershipTeam.slackGroupNames[0],
      names: leadershipTeam.slackGroupNames,
    }] : []),
  ].map((group) => ({ ...group, normalizedNames: new Set(group.names.map(normalize)) }));
  const matchedGroups = [];
  const matchedLabels = new Set();
  const userIds = [];
  userGroups.forEach((group) => {
    const names = [group?.name, group?.handle].map(normalize).filter(Boolean);
    const requestedGroup = requestedGroups.find((candidate) => names.some((name) => candidate.normalizedNames.has(name)));
    if (!requestedGroup) return;
    matchedGroups.push(clean(group?.name || group?.handle));
    matchedLabels.add(requestedGroup.label);
    userIds.push(...(Array.isArray(group?.users) ? group.users.map(clean).filter(Boolean) : []));
  });
  return {
    userIds: [...new Set(userIds)],
    matchedGroups,
    missingGroups: requestedGroups.filter((group) => !matchedLabels.has(group.label)).map((group) => group.label),
  };
};

export const matchSlackEventWorkers = ({ schedule, schedules = [], slackUsers, linkedSlackByNowstaId = new Map(), includeAllPositions = false }) => {
  const sourceSchedules = Array.isArray(schedules) && schedules.length ? schedules : [schedule].filter(Boolean);
  const people = sourceSchedules.flatMap((sourceSchedule) => (Array.isArray(sourceSchedule?.shifts) ? sourceSchedule.shifts : []).flatMap((shift) => (
    (Array.isArray(shift?.workers) ? shift.workers : []).flatMap((worker) => {
      const status = clean(worker?.status).toLowerCase();
      const position = clean(shift?.position);
      const relevantPosition = includeAllPositions || !position || EVENT_LEADERSHIP_POSITION.test(position);
      return !relevantPosition || (status && !['assigned', 'confirmed'].includes(status))
        ? []
        : [{ companyUserId: clean(worker?.companyUserId), name: clean(worker?.name), email: clean(worker?.email).toLowerCase() }];
    })
  )));
  return matchSlackPeople({ people, slackUsers, linkedSlackByNowstaId });
};

export const matchSlackEventCaptains = ({ schedules = [], slackUsers, linkedSlackByNowstaId = new Map() }) => {
  const people = (Array.isArray(schedules) ? schedules : []).flatMap((schedule) => (
    (Array.isArray(schedule?.shifts) ? schedule.shifts : []).flatMap((shift) => {
      if (!/captain/i.test(clean(shift?.position))) return [];
      return (Array.isArray(shift?.workers) ? shift.workers : []).flatMap((worker) => {
        const status = clean(worker?.status).toLowerCase();
        return status && !['assigned', 'confirmed'].includes(status)
          ? []
          : [{ companyUserId: clean(worker?.companyUserId), name: clean(worker?.name), email: clean(worker?.email).toLowerCase() }];
      });
    })
  ));
  return matchSlackPeople({ people, slackUsers, linkedSlackByNowstaId });
};

const eligibleShiftPeople = (schedules, positionPattern) => (Array.isArray(schedules) ? schedules : []).flatMap((schedule) => (
  (Array.isArray(schedule?.shifts) ? schedule.shifts : []).flatMap((shift) => {
    const position = clean(shift?.position);
    if (!positionPattern.test(position)) return [];
    return (Array.isArray(shift?.workers) ? shift.workers : []).flatMap((worker) => {
      const status = clean(worker?.status).toLowerCase();
      return status && !['assigned', 'confirmed'].includes(status) ? [] : [{
        companyUserId: clean(worker?.companyUserId), name: clean(worker?.name), email: clean(worker?.email).toLowerCase(), position,
      }];
    });
  })
));

export const matchSlackBarReturnRecipients = ({ schedules = [], slackUsers, linkedSlackByNowstaId = new Map() }) => {
  const barCaptains = eligibleShiftPeople(schedules, /\bbar\s+captain\b/i);
  const people = barCaptains.length ? barCaptains : eligibleShiftPeople(schedules, /\bcaptain\b/i);
  return matchSlackPeople({ people, slackUsers, linkedSlackByNowstaId });
};

export const matchSlackEventReporters = ({ schedules = [], slackUsers, linkedSlackByNowstaId = new Map() }) => {
  const people = eligibleShiftPeople(schedules, /(?:\bcaptain\b|lead\s+chef|ma[iî]tre(?:\s*['’]?\s*d)?)/i);
  return matchSlackPeople({ people, slackUsers, linkedSlackByNowstaId });
};

const mergeSlackMatches = (...groups) => ({
  matched: [...new Map(groups.flatMap((group) => group.matched).map((person) => [person.id, person])).values()],
  unmatched: [...new Map(groups.flatMap((group) => group.unmatched).map((person) => [`${normalize(person.name)}:${clean(person.email).toLowerCase()}`, person])).values()],
});

const frontendBaseUrl = () => clean(
  process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || process.env.CLIENT_URL || process.env.APP_URL || 'https://occdecks.com'
).replace(/^https:\/\/ocdecks\.com(?=\/|$)/i, 'https://occdecks.com').replace(/\/+$/g, '');

const guestExpiry = (date) => new Date((isoDateMs(date) || Date.now()) + (15 * DAY_MS));

const eventUrl = (event, seriesEvents = [], endDate = '') => {
  const eventIds = (seriesEvents.length ? seriesEvents : [event]).map((item) => String(item?._id || '')).filter(Boolean);
  const token = issueEventGuestAccess({ eventIds, capability: 'operations:view', expiresAt: guestExpiry(endDate || event.date) });
  return `${frontendBaseUrl()}/event-access/${encodeURIComponent(String(event._id))}?token=${encodeURIComponent(token)}`;
};

const captainBarUrl = (event, seriesEvents = [], endDate = '') => {
  const eventIds = (seriesEvents.length ? seriesEvents : [event]).map((item) => String(item?._id || '')).filter(Boolean);
  const token = issueEventGuestAccess({ eventIds, capability: 'bar:returns', expiresAt: guestExpiry(endDate || event.date) });
  return `${frontendBaseUrl()}/bar/returns?event=${encodeURIComponent(String(event._id))}&access=${encodeURIComponent(token)}`;
};

const eventReportUrl = (event, slackUserId, eventEndsAt) => {
  const token = issueEventGuestAccess({
    eventIds: [String(event._id)], capability: 'event:report', subjectId: slackUserId,
    expiresAt: new Date((new Date(eventEndsAt || event.date).getTime() || Date.now()) + (120 * DAY_MS)),
  });
  return `${frontendBaseUrl()}/event-report/${encodeURIComponent(String(event._id))}?access=${encodeURIComponent(token)}`;
};

const formatSeriesDateRange = (startDate, endDate) => {
  const startMs = isoDateMs(startDate);
  const endMs = isoDateMs(endDate);
  if (!Number.isFinite(startMs)) return clean(startDate);
  const start = new Date(startMs);
  const end = new Date(Number.isFinite(endMs) ? endMs : startMs);
  const monthDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' });
  const endLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(end);
  return startMs === end.getTime() ? endLabel : `${monthDay.format(start)} – ${endLabel}`;
};

const eventMessage = (event, schedule, series = [], seriesEvents = []) => {
  const time = [schedule?.shifts?.[0]?.startTime, schedule?.shifts?.at(-1)?.endTime].filter(Boolean).join(' – ');
  const dates = (Array.isArray(series) && series.length ? series : [schedule]).map((item) => clean(item?.date)).filter(Boolean).sort();
  const dateRange = formatSeriesDateRange(dates[0] || event.date, dates.at(-1) || event.date);
  const url = eventUrl(event, seriesEvents, dates.at(-1) || event.date);
  const details = [dateRange, time, clean(schedule?.venue || event?.meta?.venue)].filter(Boolean).join(' · ');
  return {
    text: `${slackEventSeriesTitle(event.title) || event.title} — ${dateRange} — event workspace: ${url}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: clean(slackEventSeriesTitle(event.title) || event.title).slice(0, 150), emoji: true } },
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

export const runSlackEventChannelSync = async ({ now = new Date(), eventId = '', force = false, existingOnly = false } = {}) => {
  if (activeSlackSync) return activeSlackSync;
  activeSlackSync = (async () => {
    if (!clean(process.env.SLACK_BOT_TOKEN)) return { configured: false, processed: 0, created: 0, updated: 0, skipped: 0 };
    if (!slackEventChannelsEnabled() && !force && !existingOnly) return { configured: true, enabled: false, processed: 0, created: 0, updated: 0, skipped: 0 };
    const from = new Date(now.getTime() - DAY_MS);
    const through = new Date(now.getTime() + DAY_MS);
    const targetEvent = clean(eventId) ? await Event.findById(clean(eventId)).lean() : null;
    if (clean(eventId) && !targetEvent) throw Object.assign(new Error('Event was not found'), { statusCode: 404 });
    const targetNowstaId = clean(targetEvent?.meta?.nowsta?.apiEventId);
    const targetExternalId = clean(targetEvent?.externalId);
    const targetScheduleConditions = [
      ...(targetNowstaId ? [{ nowstaEventId: targetNowstaId }] : []),
      ...(targetExternalId ? [{ externalId: targetExternalId }] : []),
    ];
    if (targetEvent && !targetScheduleConditions.length) {
      throw Object.assign(new Error('This event is not linked to a Nowsta schedule'), { statusCode: 409 });
    }
    const schedules = targetEvent
      ? await NowstaScheduleEntry.find({
          $or: targetScheduleConditions,
        }).sort({ startsAt: 1 }).limit(1).lean()
      : await NowstaScheduleEntry.find({
          entryType: 'event',
          archived: false,
          startsAt: { $gt: from, $lte: through },
        }).sort({ startsAt: 1 }).lean();
    if (!schedules.length) {
      if (targetEvent) throw Object.assign(new Error('This event has no matching Nowsta schedule'), { statusCode: 409 });
      return { configured: true, enabled: slackEventChannelsEnabled(), processed: 0, created: 0, updated: 0, skipped: 0 };
    }

    const seriesSchedules = await NowstaScheduleEntry.find({
      entryType: 'event',
      archived: false,
      date: {
        $gte: new Date(now.getTime() - 370 * DAY_MS).toISOString().slice(0, 10),
        $lte: new Date(now.getTime() + 370 * DAY_MS).toISOString().slice(0, 10),
      },
    }).sort({ date: 1, startsAt: 1 }).lean();

    const [auth, slackUsers, slackChannels, slackUserGroups, linkedStaff] = await Promise.all([
      slackAuthTest(),
      listSlackUsers(),
      listSlackChannels(),
      listSlackUserGroups(),
      Staff.find({ nowstaCompanyUserId: { $ne: '' }, slackUserId: { $ne: '' }, active: { $ne: false } })
        .select('nowstaCompanyUserId slackUserId').lean(),
    ]);
    const linkedSlackByNowstaId = new Map(linkedStaff.map((person) => [clean(person.nowstaCompanyUserId), clean(person.slackUserId)]));
    const channelsByName = new Map(slackChannels.map((channel) => [clean(channel?.name), channel]));
    const summary = { configured: true, enabled: slackEventChannelsEnabled(), manual: Boolean(targetEvent), team: clean(auth?.team), processed: 0, created: 0, updated: 0, skipped: 0, unmatched: 0, events: [] };

    for (const schedule of schedules) {
      const event = targetEvent || await findEventForSchedule(schedule);
      if (!event) {
        summary.skipped += 1;
        continue;
      }
      const assignedWorkersOnly = event?.meta?.eventReportTest === true;
      const scheduleSeries = slackScheduleSeries(schedule, seriesSchedules);
      const seriesEvents = (await Promise.all(scheduleSeries.map((seriesSchedule) => (
        clean(seriesSchedule.nowstaEventId) === clean(schedule.nowstaEventId)
          ? event
          : findEventForSchedule(seriesSchedule)
      )))).filter(Boolean);
      const storedEvent = seriesEvents.find((seriesEvent) => clean(seriesEvent?.meta?.slack?.channelId));
      const stored = storedEvent?.meta?.slack && typeof storedEvent.meta.slack === 'object'
        ? storedEvent.meta.slack
        : (event?.meta?.slack && typeof event.meta.slack === 'object' ? event.meta.slack : {});
      if (existingOnly && !clean(stored.channelId)) {
        summary.skipped += 1;
        continue;
      }
      const seriesDates = scheduleSeries.map((item) => clean(item.date)).filter(Boolean).sort();
      const seriesStartDate = seriesDates[0] || clean(event.date);
      const seriesEndDate = seriesDates.at(-1) || seriesStartDate;
      const channelName = slackEventChannelName(event, {
        startDate: seriesStartDate,
        title: scheduleSeries[0]?.title || event.title,
      });
      let channel = clean(stored.channelId)
        ? { id: clean(stored.channelId), name: clean(stored.channelName) || channelName }
        : channelsByName.get(channelName);
      let created = false;
      if (channel?.id && assignedWorkersOnly && clean(stored.channelId)) {
        try {
          await unarchiveSlackChannel(channel.id);
        } catch (error) {
          if (error?.slackCode !== 'not_archived') throw error;
        }
      }
      if (!channel?.id) {
        channel = await createSlackPrivateChannel(channelName);
        channelsByName.set(channelName, channel);
        created = true;
      } else if (clean(channel.name) !== channelName) {
        const oldName = clean(channel.name);
        channel = await renameSlackChannel(channel.id, channelName);
        if (oldName) channelsByName.delete(oldName);
        channelsByName.set(channelName, channel);
      }

      const groupMembers = assignedWorkersOnly
        ? { userIds: [], matchedGroups: [], missingGroups: [] }
        : slackEventUserGroupMembers({ event, userGroups: slackUserGroups });
      const slackUsersById = new Map(slackUsers.map((user) => [clean(user?.id), user]));
      const groupMatches = {
        matched: groupMembers.userIds.map((id) => ({
          id,
          name: clean(slackUsersById.get(id)?.profile?.real_name || slackUsersById.get(id)?.real_name || slackUsersById.get(id)?.name),
          email: clean(slackUsersById.get(id)?.profile?.email).toLowerCase(),
        })),
        unmatched: [],
      };
      const workers = mergeSlackMatches(
        matchSlackPeople({ people: eventChannelAdminPeople(event), slackUsers }),
        groupMatches,
        ...(assignedWorkersOnly ? [] : [matchSlackPeople({ people: eventLeadershipPeople(event), slackUsers })]),
        matchSlackEventWorkers({ schedules: scheduleSeries, slackUsers, linkedSlackByNowstaId, includeAllPositions: assignedWorkersOnly })
      );
      const previouslyInvited = new Set(Array.isArray(stored.invitedUserIds) ? stored.invitedUserIds.map(clean) : []);
      if (assignedWorkersOnly) {
        const assignedIds = new Set(workers.matched.map((worker) => worker.id));
        for (const userId of previouslyInvited) {
          if (assignedIds.has(userId)) continue;
          try {
            await removeSlackUserFromChannel(channel.id, userId);
            previouslyInvited.delete(userId);
          } catch (error) {
            console.warn(`Slack test-event member could not be removed from ${channel.id}: ${error?.slackCode || error?.message || 'unknown error'}`);
          }
        }
      }
      const inviteIds = workers.matched.map((worker) => worker.id).filter((id) => !previouslyInvited.has(id));
      if (inviteIds.length) await inviteSlackUsers(channel.id, inviteIds);

      let messageTs = clean(stored.messageTs);
      const primaryEvent = seriesEvents.find((seriesEvent) => !/^\s*setup\s*(?:day)?\b/i.test(clean(seriesEvent?.title))) || event;
      const currentMessage = eventMessage(primaryEvent, schedule, scheduleSeries, seriesEvents);
      if (!messageTs) {
        const posted = await postSlackMessage({ channel: channel.id, ...currentMessage });
        messageTs = clean(posted?.ts);
        if (messageTs) await pinSlackMessage(channel.id, messageTs);
      } else {
        await updateSlackMessage({ channel: channel.id, timestamp: messageTs, ...currentMessage });
      }
      const barLinksSent = new Set(Array.isArray(stored.barLinksSentKeys) ? stored.barLinksSentKeys.map(clean) : []);
      const reportRequestKeys = new Set(Array.isArray(stored.eventReportRequestKeys) ? stored.eventReportRequestKeys.map(clean) : []);
      for (const seriesSchedule of scheduleSeries) {
        const seriesEvent = seriesEvents.find((candidate) => clean(candidate?.meta?.nowsta?.apiEventId) === clean(seriesSchedule?.nowstaEventId))
          || (clean(seriesSchedule?.externalId) ? seriesEvents.find((candidate) => clean(candidate?.externalId) === clean(seriesSchedule.externalId)) : null);
        if (!seriesEvent) continue;
        const startsAt = new Date(seriesSchedule?.startsAt || `${seriesSchedule?.date}T12:00:00`).getTime();
        if (!force && Number.isFinite(startsAt) && startsAt > now.getTime() + DAY_MS) continue;
        const eventEndsAt = seriesSchedule?.endsAt || `${seriesSchedule?.date}T23:59:59-04:00`;
        const barRecipients = matchSlackBarReturnRecipients({ schedules: [seriesSchedule], slackUsers, linkedSlackByNowstaId });
        const barUrl = captainBarUrl(seriesEvent, [seriesEvent], seriesSchedule.date);
        for (const captain of barRecipients.matched) {
          const sentKey = `${seriesEvent._id}:${captain.id}`;
          if (barLinksSent.has(sentKey)) continue;
          try {
            await postSlackMessage({
              channel: captain.id,
              text: `Bar Returns access for ${seriesEvent.title}: ${barUrl}`,
              blocks: [
                { type: 'section', text: { type: 'mrkdwn', text: `*Bar Returns*\n${seriesEvent.title} · ${formatSeriesDateRange(seriesSchedule.date, seriesSchedule.date)}\nPlease confirm received quantities and enter the returns after the event.` } },
                { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open Bar Returns' }, url: barUrl, action_id: 'open_captain_bar_returns' }] },
              ],
            });
            barLinksSent.add(sentKey);
          } catch (error) {
            console.warn(`Slack bar returns link could not be sent to ${captain.id}: ${error?.slackCode || error?.message || 'unknown error'}`);
          }
        }

        if (slackEventReportsEnabledForEvent(seriesEvent)) {
          const reporters = matchSlackEventReporters({ schedules: [seriesSchedule], slackUsers, linkedSlackByNowstaId });
          for (const reporter of reporters.matched) {
            const requestKey = `${seriesEvent._id}:${reporter.id}`;
            const report = await EventReport.findOneAndUpdate(
              { eventId: seriesEvent._id, slackUserId: reporter.id },
              { $set: {
                eventTitle: clean(seriesEvent.title), eventDate: clean(seriesSchedule.date), reporterName: reporter.name,
                reporterEmail: reporter.email, position: clean(reporter.position), salesRep: eventManagerName(seriesEvent),
              }, $setOnInsert: {
                nowstaEventId: clean(seriesSchedule.nowstaEventId), eventEndsAt: new Date(eventEndsAt),
                slackUserId: reporter.id, status: 'pending',
                nextReminderAt: new Date(new Date(eventEndsAt).getTime() + eventReportReminderDelayMs(seriesEvent)),
              } },
              { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            if (report.status === 'submitted' || report.requestSentAt || reportRequestKeys.has(requestKey)) continue;
            const reportUrl = eventReportUrl(seriesEvent, reporter.id, eventEndsAt);
            try {
              await postSlackMessage({
                channel: reporter.id,
                text: `Event report for ${seriesEvent.title}: ${reportUrl}`,
                blocks: [
                  { type: 'section', text: { type: 'mrkdwn', text: `*Event Report*\n${seriesEvent.title} · ${formatSeriesDateRange(seriesSchedule.date, seriesSchedule.date)}\nPlease complete your report after the event.` } },
                  { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Complete Event Report' }, url: reportUrl, action_id: 'open_event_report' }] },
                ],
              });
              report.requestSentAt = new Date();
              if (seriesEvent?.meta?.eventReportTest === true) {
                report.nextReminderAt = new Date(report.requestSentAt.getTime() + eventReportReminderDelayMs(seriesEvent));
              }
              await report.save();
              reportRequestKeys.add(requestKey);
            } catch (error) {
              console.warn(`Slack event report link could not be sent to ${reporter.id}: ${error?.slackCode || error?.message || 'unknown error'}`);
            }
          }
        }
      }
      const invitedUserIds = [...new Set([...previouslyInvited, ...workers.matched.map((worker) => worker.id)])];
      const slackMeta = {
        channelId: clean(channel.id),
        channelName: clean(channel.name) || channelName,
        channelUrl: `https://slack.com/app_redirect?channel=${encodeURIComponent(clean(channel.id))}`,
        messageTs,
        invitedUserIds,
        barLinksSentKeys: [...barLinksSent],
        eventReportRequestKeys: [...reportRequestKeys],
        unmatchedWorkers: workers.unmatched,
        includedSlackGroups: groupMembers.matchedGroups,
        missingSlackGroups: groupMembers.missingGroups,
        salesManager: eventManagerName(event),
        seriesStartDate,
        seriesEndDate,
        seriesEventIds: seriesEvents.map((seriesEvent) => String(seriesEvent._id)),
        createdAt: stored.createdAt || new Date(),
        lastSyncedAt: new Date(),
      };
      await Event.updateMany({ _id: { $in: seriesEvents.map((seriesEvent) => seriesEvent._id) } }, { $set: {
        'meta.slack': {
          ...slackMeta,
        },
      } });
      summary.processed += 1;
      summary.unmatched += workers.unmatched.length;
      if (created) summary.created += 1;
      else summary.updated += 1;
      summary.events.push({
        eventId: String(event._id),
        channelId: clean(channel.id),
        channelName: clean(channel.name) || channelName,
        channelUrl: `https://slack.com/app_redirect?channel=${encodeURIComponent(clean(channel.id))}`,
        invited: inviteIds.length,
        unmatched: workers.unmatched,
        includedSlackGroups: groupMembers.matchedGroups,
        missingSlackGroups: groupMembers.missingGroups,
        seriesStartDate,
        seriesEndDate,
        seriesEvents: seriesEvents.length,
      });
    }
    return summary;
  })();
  try {
    return await activeSlackSync;
  } finally {
    activeSlackSync = null;
  }
};

export const runSlackEventReportReminders = async ({ now = new Date() } = {}) => {
  if (!clean(process.env.SLACK_BOT_TOKEN)) return { configured: false, sent: 0, failed: 0 };
  const globalReportsEnabled = slackEventReportsEnabled();
  const pendingFilter = {
    status: 'pending', requestSentAt: { $ne: null }, nextReminderAt: { $ne: null, $lte: now },
  };
  if (!globalReportsEnabled) {
    const testEventIds = await Event.find({ 'meta.eventReportTest': true }).distinct('_id');
    if (!testEventIds.length) return { configured: true, sent: 0, failed: 0 };
    pendingFilter.eventId = { $in: testEventIds };
    const testReminderAt = new Date(now.getTime() + TEST_REPORT_REMINDER_MS);
    await EventReport.updateMany({
      eventId: { $in: testEventIds }, status: 'pending', requestSentAt: { $ne: null },
      $or: [{ nextReminderAt: null }, { nextReminderAt: { $gt: testReminderAt } }],
    }, { $set: { nextReminderAt: testReminderAt } });
  }
  const pending = await EventReport.find(pendingFilter).sort({ nextReminderAt: 1 }).limit(200);
  const eventIds = [...new Set(pending.map((report) => String(report.eventId)))];
  const events = await Event.find({ _id: { $in: eventIds } }).select('_id title date meta.eventReportTest').lean();
  const eventsById = new Map(events.map((event) => [String(event._id), event]));
  const summary = { configured: true, sent: 0, failed: 0 };
  for (const report of pending) {
    const event = eventsById.get(String(report.eventId));
    if (!event) continue;
    const url = eventReportUrl(event, report.slackUserId, report.eventEndsAt || event.date);
    try {
      await postSlackMessage({
        channel: report.slackUserId,
        text: `Reminder: event report for ${report.eventTitle}: ${url}`,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `*Event Report Reminder*\nThe report for ${report.eventTitle} is still waiting for your response.` } },
          { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Complete Event Report' }, url, action_id: 'open_event_report_reminder' }] },
        ],
      });
      report.lastReminderAt = now;
      report.nextReminderAt = new Date(now.getTime() + eventReportReminderDelayMs(event));
      report.reminderCount = Number(report.reminderCount || 0) + 1;
      await report.save();
      summary.sent += 1;
    } catch (error) {
      summary.failed += 1;
      console.warn(`Slack event report reminder failed for ${report.slackUserId}: ${error?.slackCode || error?.message || 'unknown error'}`);
    }
  }
  return summary;
};
