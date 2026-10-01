import User from '../models/Users.js';
import ReportTeam from '../models/ReportTeam.js';
import { resolveEventSalesRep } from './eventReportSalesRep.js';

export const TEAM_USER_SELECT = '_id username email isActive jobTitle teamId receivesTeamReports';
export const normalizeSalesAlias = (value) => String(value || '').trim().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
const id = (value) => String(value || '');
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const loadReportTeamDirectory = async () => {
  const [teams, users] = await Promise.all([
    ReportTeam.find().sort({ name: 1 }).lean(),
    User.find().select(TEAM_USER_SELECT).lean(),
  ]);
  return { teams, users };
};

export const buildTeamDeliveryPlan = (team, users) => {
  const sales = users.find((user) => id(user._id) === id(team.salesUserId));
  const members = users.filter((user) => team._id && id(user.teamId) === id(team._id));
  const recipients = [sales, ...members.filter((user) => user.receivesTeamReports === true)]
    .filter((user, index, list) => user && list.findIndex((candidate) => id(candidate?._id) === id(user._id)) === index);
  const issues = [];
  if (!sales) issues.push('Sales account is missing');
  for (const user of recipients) {
    if (user.isActive === false) issues.push(`${user.username}: account is inactive`);
    if (!validEmail(String(user.email || '').trim())) issues.push(`${user.username}: valid email is required`);
  }
  return {
    teamId: id(team._id), teamName: team.name, salesUserId: id(team.salesUserId),
    salesName: sales?.username || '', enabled: team.reportDeliveryEnabled === true,
    recipients: [...new Set(recipients.map((user) => String(user.email || '').trim().toLowerCase()).filter(validEmail))],
    members, issues,
  };
};

export const resolveTeamRouting = ({ event, salesRep, teams, users }) => {
  const assignedId = id(event?.meta?.reportSalesUserId);
  const label = salesRep || resolveEventSalesRep(event);
  const alias = normalizeSalesAlias(label);
  if (!assignedId && !alias) return { status: 'blocked', issues: ['Assign a Sales representative to this event'], recipients: [] };
  const matching = teams.filter((team) => {
    if (assignedId) return id(team.salesUserId) === assignedId;
    const sales = users.find((user) => id(user._id) === id(team.salesUserId));
    return [sales?.username, sales?.email, ...(team.salesAliases || [])].some((name) => name && normalizeSalesAlias(name) === alias);
  });
  if (matching.length > 1) return { status: 'blocked', issues: ['Sales name matches more than one team; assign the Sales account explicitly'], recipients: [] };
  if (!matching.length) return {
    status: assignedId ? 'blocked' : 'legacy',
    issues: [assignedId ? 'Assigned Sales has no report team' : 'No team configured in User Administration; existing delivery rules apply'], recipients: [],
  };
  const plan = buildTeamDeliveryPlan(matching[0], users);
  return { ...plan, status: plan.enabled ? (plan.issues.length ? 'blocked' : 'ready') : 'legacy',
    issues: plan.enabled ? plan.issues : [...plan.issues, 'Team delivery is not enabled; existing delivery rules apply'] };
};
