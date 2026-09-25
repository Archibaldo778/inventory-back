const SLACK_API_URL = 'https://slack.com/api';

const clean = (value) => String(value || '').trim();

const slackGet = async (method, query = {}, { token = process.env.SLACK_BOT_TOKEN } = {}) => {
  const botToken = clean(token);
  if (!botToken) throw Object.assign(new Error('SLACK_BOT_TOKEN is not configured'), { statusCode: 503 });
  const url = new URL(`${SLACK_API_URL}/${method}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    const code = clean(payload?.error) || `http_${response.status}`;
    throw Object.assign(new Error(`Slack ${method} failed: ${code}`), { statusCode: response.status || 502, slackCode: code });
  }
  return payload;
};

const slackRequest = async (method, body = {}, { token = process.env.SLACK_BOT_TOKEN } = {}) => {
  const botToken = clean(token);
  if (!botToken) throw Object.assign(new Error('SLACK_BOT_TOKEN is not configured'), { statusCode: 503 });
  const response = await fetch(`${SLACK_API_URL}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    const code = clean(payload?.error) || `http_${response.status}`;
    throw Object.assign(new Error(`Slack ${method} failed: ${code}`), { statusCode: response.status || 502, slackCode: code });
  }
  return payload;
};

export const slackAuthTest = () => slackRequest('auth.test');

export const listSlackUsers = async () => {
  const users = [];
  let cursor = '';
  do {
    const result = await slackGet('users.list', { limit: 200, ...(cursor ? { cursor } : {}) });
    users.push(...(Array.isArray(result.members) ? result.members : []));
    cursor = clean(result?.response_metadata?.next_cursor);
  } while (cursor);
  return users;
};

export const listSlackChannels = async () => {
  const channels = [];
  let cursor = '';
  do {
    const result = await slackGet('conversations.list', {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    channels.push(...(Array.isArray(result.channels) ? result.channels : []));
    cursor = clean(result?.response_metadata?.next_cursor);
  } while (cursor);
  return channels;
};

export const listSlackUserGroups = async () => {
  const result = await slackGet('usergroups.list', { include_users: true, include_disabled: false });
  return Array.isArray(result.usergroups) ? result.usergroups : [];
};

export const createSlackPrivateChannel = async (name) => {
  const result = await slackRequest('conversations.create', { name, is_private: true });
  return result.channel;
};

export const renameSlackChannel = async (channel, name) => {
  const result = await slackRequest('conversations.rename', { channel, name });
  return result.channel;
};

export const inviteSlackUsers = async (channel, userIds = []) => {
  const unique = [...new Set(userIds.map(clean).filter(Boolean))];
  if (!unique.length) return null;
  return slackRequest('conversations.invite', { channel, users: unique.join(','), force: true });
};

export const removeSlackUserFromChannel = (channel, userId) => slackRequest('conversations.kick', {
  channel,
  user: clean(userId),
});

export const postSlackMessage = async ({ channel, text, blocks = [] }) => slackRequest('chat.postMessage', {
  channel,
  text,
  ...(blocks.length ? { blocks } : {}),
  unfurl_links: false,
  unfurl_media: false,
});

export const updateSlackMessage = async ({ channel, timestamp, text, blocks = [] }) => slackRequest('chat.update', {
  channel,
  ts: timestamp,
  text,
  ...(blocks.length ? { blocks } : {}),
});

export const pinSlackMessage = (channel, timestamp) => slackRequest('pins.add', {
  channel,
  timestamp,
});
