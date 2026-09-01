import mongoose from 'mongoose';
import { MEAL_TYPES, SOURCES } from '../config/constants.js';

/** One dish inside a meal. Nutrition numbers are AI estimates, never exact. */
const foodItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    quantity: { type: String, trim: true, maxlength: 60, default: '' },
    calories: { type: Number, default: 0, min: 0 },
    protein: { type: Number, default: 0, min: 0 },
    carbs: { type: Number, default: 0, min: 0 },
    fat: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

const mealSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mealType: { type: String, enum: MEAL_TYPES, default: 'snack', index: true },
    items: { type: [foodItemSchema], default: [] },
    /** Sum of `items`, stored so dashboards do not recompute on every read. */
    totals: {
      calories: { type: Number, default: 0, min: 0 },
      protein: { type: Number, default: 0, min: 0 },
      carbs: { type: Number, default: 0, min: 0 },
      fat: { type: Number, default: 0, min: 0 }
    },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    date: { type: Date, required: true, default: Date.now, index: true },
    source: { type: String, enum: SOURCES, default: 'manual' },
    agentRun: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun', default: null }
  },
  { timestamps: true }
);

mealSchema.index({ user: 1, date: -1 });

/** Keep `totals` in sync automatically so callers cannot forget. */
mealSchema.pre('validate', function recomputeTotals(next) {
  const round = (n) => Math.round(n * 10) / 10;
  this.totals = this.items.reduce(
    (acc, item) => ({
      calories: round(acc.calories + (item.calories || 0)),
      protein: round(acc.protein + (item.protein || 0)),
      carbs: round(acc.carbs + (item.carbs || 0)),
      fat: round(acc.fat + (item.fat || 0))
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  next();
});

export const Meal = mongoose.model('Meal', mealSchema);
