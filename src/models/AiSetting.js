import mongoose from 'mongoose';

/**
 * One row per user: which AI provider their agents use, and their key.
 *
 * Kept out of the User document on purpose. `User` is serialised to the browser
 * on every request, and a secret should never be one forgotten `delete` away
 * from being sent to the client.
 */
const aiSettingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    provider: { type: String, required: true },
    model: { type: String, default: '' },
    /** Only needed for self-hosted or `custom` endpoints. */
    baseUrl: { type: String, default: '', maxlength: 300 },
    /** AES-256-GCM. Never selected by default, never serialised. */
    key: {
      ciphertext: { type: String, default: '' },
      iv: { type: String, default: '' },
      tag: { type: String, default: '' }
    },
    /** Shown in Settings so a user can tell which key is saved. */
    keyHint: { type: String, default: '' },
    lastTestedAt: { type: Date, default: null },
    lastTestOk: { type: Boolean, default: null }
  },
  { timestamps: true }
);

aiSettingSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.key;
    delete ret.__v;
    return ret;
  }
});

export const AiSetting = mongoose.model('AiSetting', aiSettingSchema);
