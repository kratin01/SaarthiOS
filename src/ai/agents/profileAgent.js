/**
 * Profile Agent — owns the settings a user would otherwise change by hand.
 *
 * "My monthly budget is 30000" or "I am 175cm and 70kg" should not require a
 * trip to Settings. Like every other agent it only writes values the planner
 * already validated, and it never invents one.
 */
import { User } from '../../models/User.js';
import { profileDraftSchema } from '../schemas.js';
import { computeBodyTargets } from '../../services/bodyProfileService.js';

/** Only what a person would recognise, in the order they tend to say it. */
const LABELS = {
  monthlyBudget: 'monthly budget',
  dailyCalorieGoal: 'daily calorie goal',
  dailyProteinGoal: 'daily protein goal',
  heightCm: 'height',
  weightKg: 'weight',
  bodyGoal: 'body goal'
};

const describe = (key, value) => {
  if (key === 'heightCm') return `height ${value} cm`;
  if (key === 'weightKg') return `weight ${value} kg`;
  if (key === 'dailyCalorieGoal') return `calorie goal ${value} kcal`;
  if (key === 'dailyProteinGoal') return `protein goal ${value} g`;
  if (key === 'bodyGoal') return `goal ${value}`;
  return `${LABELS[key]} ${value}`;
};

export const profileAgent = {
  name: 'profile',
  label: 'Profile Agent',

  async run({ userId, draft }) {
    const parsed = profileDraftSchema.safeParse(draft ?? {});
    if (!parsed.success) {
      return { created: [], changed: [], summary: 'Nothing on the profile to change.' };
    }

    const changes = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined)
    );
    if (!Object.keys(changes).length) {
      return { created: [], changed: [], summary: 'Nothing on the profile to change.' };
    }

    const user = await User.findById(userId);
    if (!user) return { created: [], changed: [], summary: 'Could not find the account.' };

    Object.assign(user, changes);

    /*
     * Height and weight are only worth giving if something uses them, and the
     * Health page derives targets from them the moment they are entered there.
     * Doing the same here keeps the two routes consistent, but never overrides
     * a goal the user stated in the same breath.
     */
    const measured = user.heightCm && user.weightKg;
    const askedForGoals = 'dailyCalorieGoal' in changes || 'dailyProteinGoal' in changes;
    let derived = null;

    if (measured && !askedForGoals) {
      const targets = computeBodyTargets({
        heightCm: user.heightCm,
        weightKg: user.weightKg,
        bodyGoal: user.bodyGoal
      });
      // Only worth mentioning when the numbers actually move. Changing a budget
      // recomputes the same targets, and saying so implies they changed.
      if (
        targets.dailyCalorieGoal !== user.dailyCalorieGoal ||
        targets.dailyProteinGoal !== user.dailyProteinGoal
      ) {
        user.dailyCalorieGoal = targets.dailyCalorieGoal;
        user.dailyProteinGoal = targets.dailyProteinGoal;
        derived = targets;
      }
    }

    await user.save();

    const changed = Object.keys(changes);
    const parts = changed.map((key) => describe(key, changes[key]));
    const summary = derived
      ? `Updated ${parts.join(', ')}. Targets are now ${derived.dailyCalorieGoal} kcal and ${derived.dailyProteinGoal} g protein a day.`
      : `Updated ${parts.join(', ')}.`;

    return { created: [], changed, derived, summary };
  }
};
