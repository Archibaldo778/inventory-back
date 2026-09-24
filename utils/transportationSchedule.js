const clean = (value, maxLength = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const cleanTime = (value) => {
  const normalized = clean(value, 5);
  return !normalized || TIME_PATTERN.test(normalized) ? normalized : '';
};

export const normalizeTransportationRoutes = (routes = []) => (
  (Array.isArray(routes) ? routes : []).slice(0, 250).map((route, index) => {
    const driverName = clean(route?.driverName, 240);
    const source = clean(route?.driverSource, 40).toLowerCase();
    const deliveryRequired = route?.deliveryRequired !== false;
    const taskType = clean(route?.taskType, 40).toLowerCase();
    const taskSource = clean(route?.taskSource, 20).toLowerCase() === 'side' ? 'side' : 'event';
    const reviewStatus = clean(route?.reviewStatus, 20).toLowerCase() === 'confirmed' ? 'confirmed' : 'pending';
    return {
      ...(route?._id ? { _id: route._id } : {}),
      eventId: clean(route?.eventId, 120),
      eventTitle: clean(route?.eventTitle, 300),
      eventNumber: clean(route?.eventNumber, 120),
      eventVenue: clean(route?.eventVenue, 300),
      taskSource,
      taskTitle: clean(route?.taskTitle, 300),
      deliveryRequired,
      taskType: ['delivery', 'pickup', 'return', 'other'].includes(taskType) ? taskType : 'delivery',
      cargoType: clean(route?.cargoType, 160),
      driverSource: ['staff', 'operations', 'nowsta'].includes(source) ? source : '',
      driverId: clean(route?.driverId, 120),
      driverName,
      driverEmail: clean(route?.driverEmail, 240).toLowerCase(),
      driverPhone: clean(route?.driverPhone, 80),
      vehicle: clean(route?.vehicle, 160),
      callTime: cleanTime(route?.callTime),
      departureTime: cleanTime(route?.departureTime),
      onSiteTime: cleanTime(route?.onSiteTime),
      pickupTime: cleanTime(route?.pickupTime),
      address: clean(route?.address, 600),
      notes: clean(route?.notes, 2_000),
      reviewStatus,
      reviewedAt: reviewStatus === 'confirmed' && route?.reviewedAt ? route.reviewedAt : null,
      reviewedWarningKey: reviewStatus === 'confirmed' ? clean(route?.reviewedWarningKey, 1_000) : '',
      sourceEventStart: clean(route?.sourceEventStart, 120),
      sourceEventEnd: clean(route?.sourceEventEnd, 120),
      sourceAddress: clean(route?.sourceAddress, 600),
      sourceStaffFingerprint: clean(route?.sourceStaffFingerprint, 8_000),
      status: !deliveryRequired ? 'not_required' : route?.status === 'complete' ? 'complete' : driverName ? 'assigned' : 'unassigned',
      sortOrder: index,
    };
  })
);
