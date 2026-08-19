import mongoose from 'mongoose';

const normalizeRole = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'user';
  if (raw === 'superadmin') return 'super admin';
  return raw;
};

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
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
        'bar captain',
        'bartender',
      ],
      default: 'user',
    },
    seeProposals: { type: Boolean, default: false },
    seeBarFinancials: { type: Boolean, default: false },
    permissions: {
      seeProposals: { type: Boolean, default: false },
      seeBarFinancials: { type: Boolean, default: false },
    },
    // Важно: именно "password", и скрываем по умолчанию при выборке
    password: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0, min: 0, select: false },
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
  this.seeBarFinancials = nextSeeBarFinancials;
  this.permissions = {
    ...rawPermissions,
    seeProposals: nextSeeProposals,
    seeBarFinancials: nextSeeBarFinancials,
  };

  next();
});

export default mongoose.model('User', userSchema);
