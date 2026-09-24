export const OCC_OFFICE_ADDRESS = '12-16 Vestry St, New York, NY 10013';

const clean = (value, maxLength = 600) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const parseDurationSeconds = (value) => {
  const match = String(value || '').match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  return match ? Math.round(Number(match[1])) : 0;
};

const timeForRoute = (route) => clean(route?.departureTime || route?.callTime || route?.onSiteTime, 5);

const newYorkDateTime = (date, time) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const intendedUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guess = new Date(intendedUtc);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(guess).reduce((values, part) => ({ ...values, [part.type]: part.value }), {});
  const representedUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return new Date(intendedUtc - (representedUtc - guess.getTime()));
};

export const buildRouteLegs = ({ date, routes = [] }) => {
  let previousDestination = '';
  return routes.map((route, index) => {
    const taskType = clean(route?.taskType, 40).toLowerCase();
    const taskAddress = clean(route?.address);
    const returnsToOffice = taskType === 'pickup' || taskType === 'return';
    const origin = previousDestination || (returnsToOffice ? taskAddress : OCC_OFFICE_ADDRESS);
    const destination = returnsToOffice ? OCC_OFFICE_ADDRESS : taskAddress;
    previousDestination = destination;
    const departure = newYorkDateTime(date, timeForRoute(route));
    return {
      index,
      taskId: clean(route?._id, 120) || String(index),
      title: clean(route?.taskSource === 'side' ? route?.taskTitle : route?.eventTitle, 300) || 'Transportation task',
      taskType: taskType || 'delivery',
      cargoType: clean(route?.cargoType, 160),
      scheduledTime: timeForRoute(route),
      origin,
      destination,
      departureTime: departure && departure.getTime() > Date.now() + 60_000 ? departure.toISOString() : '',
      notes: clean(route?.notes, 2_000),
      vehicle: clean(route?.vehicle, 160),
    };
  });
};

const calculateLeg = async (leg, apiKey) => {
  if (!leg.origin || !leg.destination) return { ...leg, error: 'Origin or destination is missing' };
  const body = {
    origin: { address: leg.origin },
    destination: { address: leg.destination },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
    computeAlternativeRoutes: false,
    languageCode: 'en-US',
    units: 'IMPERIAL',
    ...(leg.departureTime ? { departureTime: leg.departureTime, trafficModel: 'BEST_GUESS' } : {}),
  };
  const response = await fetch(GOOGLE_ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(clean(payload?.error?.message, 600) || `Google Routes request failed (${response.status})`);
    error.statusCode = 502;
    throw error;
  }
  const route = payload?.routes?.[0];
  if (!route) return { ...leg, error: 'Google could not calculate this leg' };
  const durationSeconds = parseDurationSeconds(route.duration);
  const staticDurationSeconds = parseDurationSeconds(route.staticDuration);
  return {
    ...leg,
    distanceMeters: Number(route.distanceMeters) || 0,
    durationSeconds,
    staticDurationSeconds,
    trafficDelaySeconds: Math.max(0, durationSeconds - staticDurationSeconds),
    encodedPolyline: clean(route?.polyline?.encodedPolyline, 100_000),
  };
};

export const buildDriverRoutePreview = async ({ date, driver }) => {
  const apiKey = clean(process.env.GOOGLE_MAPS_API_KEY, 500);
  if (!apiKey) {
    const error = new Error('Google Maps API key is not configured on the server');
    error.statusCode = 503;
    throw error;
  }
  const legs = buildRouteLegs({ date, routes: driver.routes });
  const calculatedLegs = [];
  for (const leg of legs) calculatedLegs.push(await calculateLeg(leg, apiKey));
  calculatedLegs.forEach((leg, index) => {
    if (!index) return;
    const previous = calculatedLegs[index - 1];
    const [previousHour, previousMinute] = String(previous.scheduledTime || '').split(':').map(Number);
    const [hour, minute] = String(leg.scheduledTime || '').split(':').map(Number);
    if (![previousHour, previousMinute, hour, minute].every(Number.isFinite)) return;
    let availableMinutes = (hour * 60 + minute) - (previousHour * 60 + previousMinute);
    if (availableMinutes < -720) availableMinutes += 1_440;
    const requiredMinutes = Math.ceil((previous.durationSeconds || 0) / 60);
    if (availableMinutes < requiredMinutes) {
      leg.warning = `Schedule conflict: only ${Math.max(0, availableMinutes)} min allowed; the previous drive needs about ${requiredMinutes} min.`;
    }
  });
  return {
    date,
    officeAddress: OCC_OFFICE_ADDRESS,
    driver: {
      name: clean(driver.name, 240),
      phone: clean(driver.phone, 80),
      email: clean(driver.email, 240),
    },
    legs: calculatedLegs,
    totalDistanceMeters: calculatedLegs.reduce((sum, leg) => sum + (leg.distanceMeters || 0), 0),
    totalDurationSeconds: calculatedLegs.reduce((sum, leg) => sum + (leg.durationSeconds || 0), 0),
    calculatedAt: new Date().toISOString(),
  };
};
