import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSlackPeopleAudit } from '../utils/slackPeopleAudit.js';

test('Slack people audit separates matching, mismatched, missing and ambiguous accounts', () => {
  const result = buildSlackPeopleAudit({
    nowstaUsers: [
      { id: 1, first_name: 'Exact', last_name: 'Email', email: 'exact@example.com' },
      { id: 2, first_name: 'Different', last_name: 'Email', email: 'nowsta@example.com' },
      { id: 3, first_name: 'No', last_name: 'Slack', email: 'missing@example.com' },
      { id: 4, first_name: 'Missing', last_name: 'Email' },
      { id: 5, first_name: 'Duplicate', last_name: 'Name', email: 'unknown@example.com' },
    ],
    slackUsers: [
      { id: 'U1', profile: { real_name: 'Exact Email', email: 'EXACT@example.com' } },
      { id: 'U2', profile: { real_name: 'Different Email', email: 'slack@example.com' } },
      { id: 'U4', profile: { real_name: 'Missing Email', email: '' } },
      { id: 'U5', profile: { real_name: 'Duplicate Name', email: 'one@example.com' } },
      { id: 'U6', profile: { real_name: 'Duplicate Name', email: 'two@example.com' } },
    ],
  });

  assert.deepEqual(result.counts, {
    total: 5,
    email_match: 1,
    email_mismatch: 1,
    missing_email: 1,
    not_found: 1,
    ambiguous: 1,
  });
  assert.equal(result.rows.find((row) => row.nowstaId === '2').matchMethod, 'name');
});

test('saved Nowsta to Slack link wins when names and emails differ', () => {
  const result = buildSlackPeopleAudit({
    nowstaUsers: [{ id: 'N1', full_name: 'Zak', email: 'nowsta@example.com' }],
    slackUsers: [{ id: 'U1', profile: { real_name: 'Z. Smith', email: 'slack@example.com' } }],
    linkedStaff: [{ nowstaCompanyUserId: 'N1', slackUserId: 'U1' }],
  });

  assert.equal(result.rows[0].status, 'email_mismatch');
  assert.equal(result.rows[0].matchMethod, 'saved_link');
  assert.equal(result.rows[0].slackUserId, 'U1');
});
