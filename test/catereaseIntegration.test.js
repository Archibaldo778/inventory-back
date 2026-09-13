import test from 'node:test';
import assert from 'node:assert/strict';

import { OPERATIONAL_FIELDS } from '../routes/catereaseIntegration.js';

test('event required item fields exclude unsupported SubEvtNum', () => {
  const fields = OPERATIONAL_FIELDS.eventrequireditem.split(',');

  assert.equal(fields.includes('SubEvtNum'), false);
  assert.equal(fields.includes('FdSvNum'), true);
});
