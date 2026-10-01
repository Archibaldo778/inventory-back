export const EVENT_REPORT_CONTEXT_SELECT = 'managerId catereaseOperations meta';

export const resolveEventSalesRep = (event, fallback = '') => {
  const candidates = [
    event?.meta?.reportSalesRep,
    event?.managerName, event?.salesRepName, event?.sales_rep_name, event?.manager_name,
    event?.salesRepFullName, event?.sales_rep_full_name, event?.managerFullName, event?.manager_full_name,
    event?.salesRep, event?.sales_rep, event?.sales, event?.manager,
    event?.manager?.name, event?.manager?.fullName, event?.salesRep?.name, event?.salesRep?.fullName,
    event?.catereaseOperations?.salesRep, event?.catereaseOperations?.snapshot?.salesRep,
    event?.meta?.salesRep, event?.managerId,
    event?.meta?.catereaseOperations?.salesRep, event?.meta?.catereaseSnapshot?.salesRep,
    event?.meta?.caterease?.salesRep, event?.meta?.calendar?.salesRep,
    event?.meta?.managerName, event?.meta?.salesRepName, event?.meta?.manager, event?.meta?.sales,
    fallback,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return (value || '').trim().slice(0, 200);
};

export const resolveReportSalesRep = (report, event) => {
  const saved = typeof report?.salesRep === 'string' ? report.salesRep.trim() : '';
  if (report?.status === 'submitted' && saved) return saved;
  return resolveEventSalesRep(event, saved);
};
