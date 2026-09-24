import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperationsPeople, matchStaffByName } from '../utils/operationsRoster.js';

test('operations roster includes driver shifts and ignores unrelated workers', () => {
  const people = buildOperationsPeople([{
    title: 'Deliveries',
    departmentName: 'Event Drivers',
    shifts: [{
      position: 'Driver',
      workers: [{ companyUserId: '72', name: 'Oleksandr Stupak', email: 'driver@example.com' }],
    }, {
      position: 'Coordinator',
      workers: [{ companyUserId: '99', name: 'Office Person' }],
    }],
  }]);
  assert.equal(people.length, 1);
  assert.equal(people[0].fullName, 'Oleksandr Stupak');
  assert.deepEqual(people[0].roles, ['Driver']);
});

test('existing staff is matched by normalized full name', () => {
  const matched = matchStaffByName(
    { fullName: '  John   SMITH ' },
    [{ _id: 'staff-1', firstName: 'John', lastName: 'Smith', positions: ['Bartender'] }]
  );
  assert.equal(matched?._id, 'staff-1');
});
