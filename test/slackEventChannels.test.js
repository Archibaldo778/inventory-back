import test from 'node:test';
import assert from 'node:assert/strict';

import {
  eventChannelAdminPeople,
  eventLeadershipPeople,
  eventReportReminderDelayMs,
  matchSlackBarReturnRecipients,
  matchSlackEventCaptains,
  matchSlackEventReporters,
  matchSlackEventWorkers,
  slackEventChannelName,
  slackEventReportsEnabledForEvent,
  slackEventSeriesKey,
  slackScheduleSeries,
  slackEventUserGroupMembers,
} from '../utils/slackEventChannels.js';

test('every event channel includes the permanent channel administrators', () => {
  assert.deepEqual(eventChannelAdminPeople().map((person) => person.name), [
    'Ivan Vyskrebentsev',
    'Iurie Scurtul',
    'Chris Olson',
  ]);
  assert.deepEqual(eventChannelAdminPeople({ meta: { eventReportTest: true } }), []);
});

test('event report DMs can be enabled only for an explicitly marked test event', () => {
  const previous = process.env.SLACK_EVENT_REPORTS_ENABLED;
  delete process.env.SLACK_EVENT_REPORTS_ENABLED;
  try {
    assert.equal(slackEventReportsEnabledForEvent({}), false);
    assert.equal(slackEventReportsEnabledForEvent({ meta: { eventReportTest: true } }), true);
  } finally {
    if (previous === undefined) delete process.env.SLACK_EVENT_REPORTS_ENABLED;
    else process.env.SLACK_EVENT_REPORTS_ENABLED = previous;
  }
});

test('event report reminders repeat daily for test and normal reports', () => {
  assert.equal(eventReportReminderDelayMs({ meta: { eventReportTest: true } }), 24 * 60 * 60 * 1000);
  assert.equal(eventReportReminderDelayMs({}), 24 * 60 * 60 * 1000);
});

test('Slack event channel names are stable, valid, and short', () => {
  const name = slackEventChannelName({
    date: '2026-09-24',
    title: 'Prada Donna & Uomo Appointments — DAY 1',
    externalId: 'E22847-S62831',
  });
  assert.equal(name, '09-24-prada-donna-uomo-appointments');
  assert.match(name, /^[a-z0-9_-]{1,80}$/);
});

test('Slack event series share one channel based on the first date', () => {
  const schedules = [
    { _id: 'one', nowstaEventId: 'one', date: '2026-09-23', title: 'Dieter Van Beneden Dinner - Day 1' },
    { _id: 'two', nowstaEventId: 'two', date: '2026-09-24', title: 'Dieter Van Beneden Dinner - Day 2' },
    { _id: 'three', nowstaEventId: 'three', date: '2026-09-25', title: 'Dieter Van Beneden Dinner - Day 3' },
    { _id: 'later', nowstaEventId: 'later', date: '2027-09-23', title: 'Dieter Van Beneden Dinner - Day 1' },
  ];
  assert.equal(slackEventSeriesKey(schedules[0].title), 'dieter van beneden dinner');
  const series = slackScheduleSeries(schedules[1], schedules);
  assert.deepEqual(series.map((schedule) => schedule.nowstaEventId), ['one', 'two', 'three']);
  assert.equal(slackEventChannelName({ title: schedules[1].title }, {
    startDate: series[0].date,
    title: series[0].title,
  }), '09-23-dieter-van-beneden-dinner');
});

test('Setup Day and the main event share the setup date and main event channel name', () => {
  const schedules = [
    { _id: 'setup', nowstaEventId: 'setup', date: '2026-09-25', title: 'Setup Day - Nicky Reinhard Plans a Wedding' },
    { _id: 'main', nowstaEventId: 'main', date: '2026-09-26', title: 'Nicky Reinhard Plans a Wedding' },
  ];
  assert.equal(slackEventSeriesKey(schedules[0].title), slackEventSeriesKey(schedules[1].title));
  const series = slackScheduleSeries(schedules[1], schedules);
  assert.deepEqual(series.map((schedule) => schedule.nowstaEventId), ['setup', 'main']);
  assert.equal(slackEventChannelName({ title: schedules[0].title }, {
    startDate: series[0].date,
    title: series[0].title,
  }), '09-25-nicky-reinhard-plans-a-wedding');
});

test('event leadership includes the sales manager and configured assistants', () => {
  assert.deepEqual(
    eventLeadershipPeople({ managerId: 'Olivier Cheng' }).map((person) => person.name),
    ['Olivier Cheng', 'Ashley', 'Sebastian', 'Heidi']
  );
  assert.deepEqual(
    eventLeadershipPeople({ meta: { salesRep: 'George Smith' } }).map((person) => person.name),
    ['George Smith', 'Megan']
  );
  assert.deepEqual(eventLeadershipPeople({ managerId: 'Guillaume Darriet' }), [{ name: 'Guillaume Darriet' }]);
  assert.deepEqual(eventLeadershipPeople({ managerId: 'Emma' }), [{ name: 'Emma' }]);
  assert.deepEqual(
    eventLeadershipPeople({ catereaseOperations: { salesRep: 'Olivier Cheng' } }).map((person) => person.name),
    ['Olivier Cheng', 'Ashley', 'Sebastian', 'Heidi']
  );
});

test('unique first names can match Slack users for configured assistants', () => {
  const result = matchSlackEventWorkers({
    schedule: { shifts: [{ workers: [{ name: 'Ashley', status: 'confirmed' }] }] },
    slackUsers: [
      { id: 'U1', name: 'ashley', profile: { real_name: 'Ashley Smith', email: 'ashley@example.com' } },
    ],
  });
  assert.equal(result.matched[0]?.id, 'U1');
  assert.equal(result.unmatched.length, 0);
});

test('Slack group membership includes Leadership Team and the sales manager team', () => {
  const result = slackEventUserGroupMembers({
    event: { managerId: 'Olivier Cheng' },
    userGroups: [
      { name: 'Leadership Team', users: ['U1', 'U2'] },
      { name: 'teamOC', users: ['U2', 'U3'] },
      { name: 'Team George', users: ['U4'] },
    ],
  });
  assert.deepEqual(result.userIds, ['U1', 'U2', 'U3']);
  assert.deepEqual(result.matchedGroups, ['Leadership Team', 'teamOC']);
  assert.deepEqual(result.missingGroups, []);
});

test('Slack event workers match by email first and unique name second', () => {
  const result = matchSlackEventWorkers({
    schedule: {
      shifts: [{ workers: [
        { name: 'Elvin Veras', email: 'elvin@example.com', status: 'confirmed' },
        { name: 'Attilio Campos', email: '', status: 'assigned' },
        { name: 'Not Confirmed', email: 'no@example.com', status: 'declined' },
        { name: 'Missing Person', email: 'missing@example.com', status: 'confirmed' },
      ] }],
    },
    slackUsers: [
      { id: 'U1', profile: { email: 'elvin@example.com', real_name: 'Different Slack Name' } },
      { id: 'U2', profile: { email: 'attilio@example.com', real_name: 'Attilio Campos' } },
    ],
  });
  assert.deepEqual(result.matched.map((worker) => worker.id), ['U1', 'U2']);
  assert.deepEqual(result.unmatched, [{ name: 'Missing Person', email: 'missing@example.com' }]);
});

test('Slack event workers include only operational leadership and drivers', () => {
  const result = matchSlackEventWorkers({
    schedule: {
      shifts: [
        { position: 'Captain', workers: [{ name: 'Captain One', status: 'confirmed' }] },
        { position: 'Lead Chef', workers: [{ name: 'Chef One', status: 'assigned' }] },
        { position: 'Maitre D', workers: [{ name: 'Maitre One', status: 'confirmed' }] },
        { position: 'Driver', workers: [{ name: 'Driver One', status: 'confirmed' }] },
        { position: 'Bartender', workers: [{ name: 'Bartender One', status: 'confirmed' }] },
      ],
    },
    slackUsers: [
      { id: 'U1', profile: { real_name: 'Captain One' } },
      { id: 'U2', profile: { real_name: 'Chef One' } },
      { id: 'U3', profile: { real_name: 'Maitre One' } },
      { id: 'U4', profile: { real_name: 'Driver One' } },
      { id: 'U5', profile: { real_name: 'Bartender One' } },
    ],
  });
  assert.deepEqual(result.matched.map((worker) => worker.id), ['U1', 'U2', 'U3', 'U4']);
});

test('test event channels can include every assigned worker without leadership groups', () => {
  const result = matchSlackEventWorkers({
    includeAllPositions: true,
    schedule: {
      shifts: [
        { position: 'Captain', workers: [{ name: 'Captain One', status: 'confirmed' }] },
        { position: 'Bartender', workers: [{ name: 'Bartender One', status: 'assigned' }] },
        { position: 'Server', workers: [{ name: 'Declined Server', status: 'declined' }] },
      ],
    },
    slackUsers: [
      { id: 'U1', profile: { real_name: 'Captain One' } },
      { id: 'U2', profile: { real_name: 'Bartender One' } },
      { id: 'U3', profile: { real_name: 'Declined Server' } },
    ],
  });
  assert.deepEqual(result.matched.map((worker) => worker.id), ['U1', 'U2']);
});

test('Slack event workers include leadership from every day in a series and match Zak aliases', () => {
  const result = matchSlackEventWorkers({
    schedules: [
      { shifts: [{ position: "Maitre D'", workers: [{ name: 'Maitre One', status: 'confirmed' }] }] },
      { shifts: [{ position: 'Floor Captain', workers: [{ name: 'Zak', status: 'assigned' }] }] },
    ],
    slackUsers: [
      { id: 'U1', profile: { real_name: 'Maitre One' } },
      { id: 'U2', profile: { real_name: 'Zach Smith' } },
    ],
  });
  assert.deepEqual(result.matched.map((worker) => worker.id), ['U1', 'U2']);
});

test('captain direct access goes only to confirmed or assigned captains', () => {
  const result = matchSlackEventCaptains({
    schedules: [{ shifts: [
      { position: 'Captain - Working', workers: [{ name: 'Captain One', status: 'confirmed' }] },
      { position: 'Bar Captain', workers: [{ name: 'Captain Two', status: 'assigned' }, { name: 'Declined Captain', status: 'declined' }] },
      { position: 'Lead Chef', workers: [{ name: 'Chef One', status: 'confirmed' }] },
    ] }],
    slackUsers: [
      { id: 'U1', profile: { real_name: 'Captain One' } },
      { id: 'U2', profile: { real_name: 'Captain Two' } },
      { id: 'U3', profile: { real_name: 'Declined Captain' } },
      { id: 'U4', profile: { real_name: 'Chef One' } },
    ],
  });
  assert.deepEqual(result.matched.map((worker) => worker.id), ['U1', 'U2']);
});

test('bar returns prefer bar captains and fall back to regular captains', () => {
  const slackUsers = [
    { id: 'UBAR', profile: { real_name: 'Bar Captain' } },
    { id: 'UFLOOR', profile: { real_name: 'Floor Captain' } },
  ];
  const withBarCaptain = matchSlackBarReturnRecipients({
    schedules: [{ shifts: [
      { position: 'Bar Captain', workers: [{ name: 'Bar Captain', status: 'confirmed' }] },
      { position: 'Floor Captain', workers: [{ name: 'Floor Captain', status: 'confirmed' }] },
    ] }],
    slackUsers,
  });
  assert.deepEqual(withBarCaptain.matched.map((worker) => worker.id), ['UBAR']);

  const withoutBarCaptain = matchSlackBarReturnRecipients({
    schedules: [{ shifts: [{ position: 'Captain - Working', workers: [{ name: 'Floor Captain', status: 'assigned' }] }] }],
    slackUsers,
  });
  assert.deepEqual(withoutBarCaptain.matched.map((worker) => worker.id), ['UFLOOR']);
});

test('event reports go to captains, maitre d and lead chefs only', () => {
  const result = matchSlackEventReporters({
    schedules: [{ shifts: [
      { position: 'Floor Captain', workers: [{ name: 'Captain One', status: 'confirmed' }] },
      { position: "Maitre D'", workers: [{ name: 'Maitre One', status: 'assigned' }] },
      { position: 'Lead Chef', workers: [{ name: 'Chef One', status: 'confirmed' }] },
      { position: 'Driver', workers: [{ name: 'Driver One', status: 'confirmed' }] },
    ] }],
    slackUsers: [
      { id: 'U1', profile: { real_name: 'Captain One' } },
      { id: 'U2', profile: { real_name: 'Maitre One' } },
      { id: 'U3', profile: { real_name: 'Chef One' } },
      { id: 'U4', profile: { real_name: 'Driver One' } },
    ],
  });
  assert.deepEqual(result.matched.map((worker) => worker.id), ['U1', 'U2', 'U3']);
  assert.deepEqual(result.matched.map((worker) => worker.position), ['Floor Captain', "Maitre D'", 'Lead Chef']);
});

test('saved Nowsta to Slack link overrides different email and display name', () => {
  const result = matchSlackEventWorkers({
    schedule: { shifts: [{ position: 'Floor Captain', workers: [{
      companyUserId: 'nowsta-72', name: 'Zak', email: 'zak@nowsta.example', status: 'confirmed',
    }] }] },
    slackUsers: [{ id: 'U72', profile: { real_name: 'Z. Smith', email: 'different@slack.example' } }],
    linkedSlackByNowstaId: new Map([['nowsta-72', 'U72']]),
  });
  assert.deepEqual(result.matched.map((worker) => worker.id), ['U72']);
  assert.equal(result.unmatched.length, 0);
});
