const roundMoney = (value) => Math.round(value * 100) / 100;

export const normalizeBarEventNumber = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/\s+/g, '');

const normalizeEventName = (value) => String(value || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

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
  const unnumberedEventsByNameDate = new Map();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const key = normalizeBarEventNumber(event?.eventNumber);
    if (key) {
      if (!eventsByNumber.has(key)) eventsByNumber.set(key, []);
      eventsByNumber.get(key).push(event);
      return;
    }
    const name = normalizeEventName(event?.name);
    const date = String(event?.eventDate || '');
    if (!name || !date) return;
    const nameDateKey = `${date}|${name}`;
    if (!unnumberedEventsByNameDate.has(nameDateKey)) unnumberedEventsByNameDate.set(nameDateKey, []);
    unnumberedEventsByNameDate.get(nameDateKey).push(event);
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
    let matches = eventsByNumber.get(eventNumber) || [];
    let matchMethod = 'event_number';
    if (!matches.length) {
      const nameDateKey = `${row.eventDate}|${normalizeEventName(row.partyName)}`;
      matches = unnumberedEventsByNameDate.get(nameDateKey) || [];
      matchMethod = 'name_date';
      if (!matches.length) {
        resultRows.push({ ...row, status: 'unmatched', message: 'No Bar Event matched this Event # or exact name and date.' });
        return;
      }
    }
    if (matches.length > 1) {
      resultRows.push({
        ...row,
        status: 'conflict',
        message: matchMethod === 'event_number'
          ? 'More than one Bar Event has this event number.'
          : 'More than one unnumbered Bar Event has this name and date.',
      });
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
    const assignEventNumber = !event.eventNumber && Boolean(row.eventNumber);
    const status = event.currentCharge === row.clientCharge && !assignEventNumber ? 'unchanged' : 'matched';
    resultRows.push({
      ...row,
      ...event,
      eventNumber: row.eventNumber,
      sourceEventNumber: row.eventNumber,
      matchMethod,
      assignEventNumber,
      status,
      message: status === 'unchanged'
        ? 'Charge is already current.'
        : (assignEventNumber ? 'Matched by exact name and date; Event # will be assigned.' : 'Ready to import.'),
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
