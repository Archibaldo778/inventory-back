import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    role:     { type: String, enum: ['user', 'manager', 'admin', 'super Admin'], default: 'user' },
    // Важно: именно "password", и скрываем по умолчанию при выборке
    password: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);