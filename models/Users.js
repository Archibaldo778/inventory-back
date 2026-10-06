import mongoose from 'mongoose';

const normalizeRole = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'user';
  if (raw === 'superadmin') return 'super admin';
  return raw;
};

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    nowstaName: { type: String, default: '', trim: true },
    jobTitle: { type: String, enum: ['', 'sales', 'team manager', 'assistant', 'executive chef'], default: '' },
    accessRoleId: { type: String, default: '', trim: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReportTeam', default: null },
    receivesTeamReports: { type: Boolean, default: false },
    role: {
      type: String,
      enum: [
        'user',
        'manager',
        'sales rep',
        'admin',
        'super admin',
        'super Admin',
        'bar admin',
        'kitchen admin',
        'staffing admin',
        'captain',
        'bar captain',
        'bartender',
        'packer',
        'uniform packer',
        'event staff',
        'kitchen lead',
      ],
      default: 'user',
    },
    seeProposals: { type: Boolean, default: false },
    accessAudit: { type: [mongoose.Schema.Types.Mixed], default: undefined, select: false },
    seeBarFinancials: { type: Boolean, default: false },
    permissions: {
      inventoryRead: { type: Boolean, default: false },
      seeProposals: { type: Boolean, default: false },
      seeBarFinancials: { type: Boolean, default: false },
    },
    schedulePreferences: {
      initialized: { type: Boolean, default: false },
      departments: { type: [String], default: [] },
      entryTypes: { type: [String], default: ['event'] },
      staffingProgress: {
        type: [String],
        default: ['fully_staffed', 'incomplete', 'declined', 'empty'],
      },
      showArchived: { type: Boolean, default: false },
      updatedAt: { type: Date, default: null },
    },
    // Важно: именно "password", и скрываем по умолчанию при выборке
    password: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0, min: 0, select: false },
    passwordResetHash: { type: String, default: '', select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false },
    passwordResetRequestedAt: { type: Date, default: null, select: false },
    passwordResetVersion: { type: Number, default: null, select: false },
    passwordResetEmail: { type: String, default: '', select: false },
    inviteTokenHash: { type: String, default: '', select: false },
    inviteReminderTokenHash: { type: String, default: '', select: false },
    inviteReminderAttemptedAt: { type: Date, default: null, select: false },
    inviteReminderSentAt: { type: Date, default: null, select: false },
    inviteReminderError: { type: String, default: '', select: false },
    inviteExpiresAt: { type: Date, default: null },
    inviteSender: {
      type: new mongoose.Schema({ name: { type: String, trim: true }, email: { type: String, trim: true, lowercase: true } }, { _id: false }),
      default: undefined,
    },
    inviteSentAt: { type: Date, default: null },
    inviteAcceptedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.pre('validate', function syncPermissions(next) {
  const role = normalizeRole(this.role);
  this.role = role;

  const rawPermissions = this.permissions && typeof this.permissions.toObject === 'function'
    ? this.permissions.toObject()
    : (this.permissions || {});

  const permissionsSeeProposals =
    typeof rawPermissions?.seeProposals === 'boolean' ? rawPermissions.seeProposals : undefined;
  const permissionsSeeBarFinancials =
    typeof rawPermissions?.seeBarFinancials === 'boolean' ? rawPermissions.seeBarFinancials : undefined;

  const nextSeeProposals =
    typeof this.seeProposals === 'boolean'
      ? this.seeProposals
      : (typeof permissionsSeeProposals === 'boolean' ? permissionsSeeProposals : false);

  this.seeProposals = nextSeeProposals;
  const nextSeeBarFinancials =
    typeof this.seeBarFinancials === 'boolean'
      ? this.seeBarFinancials
      : (typeof permissionsSeeBarFinancials === 'boolean' ? permissionsSeeBarFinancials : false);
  this.seeBarFinancials = ['kitchen admin', 'staffing admin'].includes(role) ? false : nextSeeBarFinancials;
  this.permissions = {
    ...rawPermissions,
    seeProposals: nextSeeProposals,
    seeBarFinancials: this.seeBarFinancials,
  };

  next();
});

export default mongoose.model('User', userSchema);
