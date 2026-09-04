import mongoose from 'mongoose';
import { CUSTOM_FIELD_TYPES, STORABLE_AGENT_ICONS } from '../config/constants.js';

/**
 * An agent the user built themselves.
 *
 * `fields` is the important part: it is the schema the user designed, and it is
 * what turns a free-text prompt into structured data. The planner is told about
 * these fields, the runtime agent validates against them, and the page renders
 * columns from them.
 */
const fieldSchema = new mongoose.Schema(
  {
    /** Stable machine name. Derived from the label once, then never changes. */
    key: { type: String, required: true, trim: true, maxlength: 40 },
    label: { type: String, required: true, trim: true, maxlength: 40 },
    type: { type: String, enum: CUSTOM_FIELD_TYPES, default: 'number' },
    /** Shown next to the number: "km", "mins", "pages". */
    unit: { type: String, trim: true, maxlength: 12, default: '' }
  },
  { _id: false }
);

const customAgentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    /** Used in the URL and as the agent's id in the AI plan. */
    slug: { type: String, required: true, trim: true, maxlength: 40 },
    description: { type: String, trim: true, maxlength: 160, default: '' },
    /** The user's own instructions, pasted into the planner prompt verbatim. */
    prompt: { type: String, trim: true, maxlength: 1000, default: '' },
    fields: {
      type: [fieldSchema],
      required: true,
      validate: [(v) => v.length > 0 && v.length <= 6, 'An agent needs between 1 and 6 stats.']
    },
    icon: { type: String, enum: STORABLE_AGENT_ICONS, default: 'spark' },
    /** Paused agents keep their data but leave the prompt and the sidebar. */
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

customAgentSchema.index({ user: 1, slug: 1 }, { unique: true });

export const CustomAgent = mongoose.model('CustomAgent', customAgentSchema);
