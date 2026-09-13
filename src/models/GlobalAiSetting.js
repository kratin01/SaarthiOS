/**
 * The AI everyone uses unless they have set their own.
 *
 * One row, no `user`. Deliberately separate from `AiSetting` rather than the
 * admin's personal row doubling as the default: an operator testing a model on
 * their own account should not silently change it for every other user.
 *
 * It also means the shared key can be changed from the Admin page instead of
 * editing `.env` and restarting the server.
 */
import mongoose from 'mongoose';

const globalAiSettingSchema = new mongoose.Schema(
  {
    /** Always "default". Gives the singleton a stable, unique handle. */
    scope: { type: String, default: 'default', unique: true },
    provider: { type: String, required: true },
    model: { type: String, default: '' },
    baseUrl: { type: String, default: '', maxlength: 300 },
    /** AES-256-GCM, same as a user's key. Never selected into JSON. */
    key: {
      ciphertext: { type: String, default: '' },
      iv: { type: String, default: '' },
      tag: { type: String, default: '' }
    },
    keyHint: { type: String, default: '' },
    /** Which admin last changed it, so the trail is not anonymous. */
    updatedBy: { type: String, default: '' },
    lastTestedAt: { type: Date, default: null },
    lastTestOk: { type: Boolean, default: null }
  },
  { timestamps: true }
);

globalAiSettingSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.key;
    delete ret.__v;
    return ret;
  }
});

export const GlobalAiSetting = mongoose.model('GlobalAiSetting', globalAiSettingSchema);
