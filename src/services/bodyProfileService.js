/**
 * Body profile maths: BMI, and the calorie and protein targets suggested from
 * it. Kept on the server so there is one copy of the rules, and kept simple on
 * purpose — see the note at the bottom.
 */
import { BODY_GOALS } from '../config/constants.js';

/** kcal per kg of body weight per day for someone moderately active. */
const MAINTENANCE_PER_KG = 31;

const GOAL_RULES = {
  lean: {
    label: 'Lean',
    /** A modest deficit. Protein goes up, because a deficit is when muscle is at risk. */
    calorieFactor: 0.85,
    proteinPerKg: 2.0,
    note: 'A gentle deficit with high protein, so you lose fat rather than muscle.'
  },
  normal: {
    label: 'Maintain',
    calorieFactor: 1,
    proteinPerKg: 1.4,
    note: 'Roughly what you burn, with enough protein to hold what you have.'
  },
  bulky: {
    label: 'Bulk',
    calorieFactor: 1.15,
    proteinPerKg: 1.8,
    note: 'A small surplus. Bigger is not better here — it just adds fat.'
  }
};

/** The standard WHO bands. */
function bmiBand(bmi) {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Overweight';
  return 'Obese';
}

const round = (n, step) => Math.round(n / step) * step;

export function computeBodyTargets({ heightCm, weightKg, bodyGoal = 'normal' }) {
  const goal = GOAL_RULES[bodyGoal] ?? GOAL_RULES.normal;

  const heightM = heightCm / 100;
  const bmi = Math.round((weightKg / (heightM * heightM)) * 10) / 10;

  const maintenance = weightKg * MAINTENANCE_PER_KG;

  return {
    bmi,
    bmiBand: bmiBand(bmi),
    maintenanceCalories: round(maintenance, 10),
    dailyCalorieGoal: round(maintenance * goal.calorieFactor, 10),
    dailyProteinGoal: round(weightKg * goal.proteinPerKg, 5),
    goalLabel: goal.label,
    note: goal.note
  };
}

export const bodyGoalOptions = BODY_GOALS.map((value) => ({
  value,
  label: GOAL_RULES[value].label,
  note: GOAL_RULES[value].note
}));

/**
 * Why this is deliberately simple: a Mifflin-St Jeor BMR needs age and sex, and
 * guessing either produces a confident number that is wrong for half of users.
 * Calories per kg and protein per kg are the rules of thumb dietitians actually
 * hand out, they need only what the user typed, and the result is presented as
 * an editable starting point rather than a prescription.
 */
