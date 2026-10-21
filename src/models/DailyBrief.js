import mongoose from 'mongoose';

/**
 * What the insight agent last wrote for one Overview slot, so opening the
 * Overview reuses it for the rest of the day instead of calling the AI again.
 */
const dailyBriefSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** `insights:today`, `insights:month` or `inspiration`. */
    slot: { type: String, required: true, maxlength: 40 },
    /** Local `YYYY-MM-DD` it was written on; any other day means stale. */
    day: { type: String, required: true },
    content: { type: mongoose.Schema.Types.Mixed, default: null },
    /** The last few inspiration lines, so a refresh does not repeat itself. */
    recent: { type: [String], default: [] }
  },
  { timestamps: true }
);

dailyBriefSchema.index({ user: 1, slot: 1 }, { unique: true });

export const DailyBrief = mongoose.model('DailyBrief', dailyBriefSchema);
