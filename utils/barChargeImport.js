const roundMoney = (value) => Math.round(value * 100) / 100;

export const normalizeBarEventNumber = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/\s+/g, '');

const money = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? roundMoney(numeric) : null;
};

const normalizeRow = (row, index) => {
  const beverageSubtotal = money(row?.beverageSubtotal);
  const liquorSubtotal = money(row?.liquorSubtotal);
  return {
    sourceIndex: index,
    eventNumber: normalizeBarEventNumber(row?.eventNumber),
    eventDate: String(row?.eventDate || '').trim(),
    partyName: String(row?.partyName || '').trim().slice(0, 240),
    salesRep: String(row?.salesRep || '').trim().slice(0, 180),
    beverageSubtotal,
    liquorSubtotal,
    clientCharge: beverageSubtotal === null || liquorSubtotal === null
      ? null
      : roundMoney(beverageSubtotal + liquorSubtotal),
  };
};

const publicEvent = (event) => ({
  eventId: String(event?._id || event?.id || ''),
  eventNumber: String(event?.eventNumber || ''),
  eventDate: String(event?.eventDate || ''),
  eventName: String(event?.name || ''),
  client: String(event?.client || ''),
  currentCharge: roundMoney(Number(event?.clientCharge) || 0),
});

export const prepareBarChargeImport = ({ rows, events, from, to }) => {
  const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeRow);
  const resultRows = [];
  const grouped = new Map();

  normalizedRows.forEach((row) => {
    if (!row.eventNumber || !/^\d{4}-\d{2}-\d{2}$/.test(row.eventDate) || row.clientCharge === null) {
      resultRows.push({ ...row, status: 'invalid', message: 'Invalid event number, date or charge amount.' });
      return;
    }
    if (row.eventDate < from || row.eventDate > to) {
      resultRows.push({ ...row, status: 'outside_range', message: 'Outside the selected date range.' });
      return;
    }
    if (!grouped.has(row.eventNumber)) grouped.set(row.eventNumber, []);
    grouped.get(row.eventNumber).push(row);
  });

  const eventsByNumber = new Map();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const key = normalizeBarEventNumber(event?.eventNumber);
    if (!key) return;
    if (!eventsByNumber.has(key)) eventsByNumber.set(key, []);
    eventsByNumber.get(key).push(event);
  });

  grouped.forEach((duplicates, eventNumber) => {
    const signatures = new Set(duplicates.map((row) => (
      `${row.eventDate}|${row.beverageSubtotal}|${row.liquorSubtotal}`
    )));
    if (signatures.size > 1) {
      resultRows.push({
        ...duplicates[0],
        status: 'conflict',
        message: `${duplicates.length} different charge rows exist for this event number.`,
      });
      return;
    }
    const row = duplicates[0];
    const matches = eventsByNumber.get(eventNumber) || [];
    if (!matches.length) {
      resultRows.push({ ...row, status: 'unmatched', message: 'Event number was not found in Bar Events.' });
      return;
    }
    if (matches.length > 1) {
      resultRows.push({ ...row, status: 'conflict', message: 'More than one Bar Event has this event number.' });
      return;
    }
    const event = publicEvent(matches[0]);
    if (event.eventDate !== row.eventDate) {
      resultRows.push({
        ...row,
        ...event,
        sourceEventNumber: row.eventNumber,
        status: 'date_mismatch',
        message: `Workbook date ${row.eventDate} does not match event date ${event.eventDate}.`,
      });
      return;
    }
    const status = event.currentCharge === row.clientCharge ? 'unchanged' : 'matched';
    resultRows.push({
      ...row,
      ...event,
      sourceEventNumber: row.eventNumber,
      status,
      message: status === 'unchanged' ? 'Charge is already current.' : 'Ready to import.',
      duplicateCount: duplicates.length - 1,
    });
  });

  resultRows.sort((left, right) => (
    String(left.eventDate).localeCompare(String(right.eventDate))
    || String(left.eventNumber).localeCompare(String(right.eventNumber))
  ));
  const importableRows = resultRows.filter((row) => row.status === 'matched');
  const unchangedRows = resultRows.filter((row) => row.status === 'unchanged');
  const matchedRows = [...importableRows, ...unchangedRows];
  return {
    rows: resultRows,
    importableRows,
    summary: {
      totalRows: normalizedRows.length,
      inRangeRows: normalizedRows.filter((row) => row.eventDate >= from && row.eventDate <= to).length,
      changes: importableRows.length,
      unchanged: unchangedRows.length,
      unmatched: resultRows.filter((row) => row.status === 'unmatched').length,
      errors: resultRows.filter((row) => ['invalid', 'conflict', 'date_mismatch'].includes(row.status)).length,
      outsideRange: resultRows.filter((row) => row.status === 'outside_range').length,
      selectedChargeTotal: roundMoney(matchedRows.reduce((total, row) => total + row.clientCharge, 0)),
    },
  };
};
