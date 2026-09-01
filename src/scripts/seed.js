/**
 * Fills an existing account with ~45 days of sample data so the dashboards have
 * something to draw. Safe to re-run: it clears previous sample rows first.
 *
 *   npm run seed -- your@email.com
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { User, Expense, Meal, Investment } from '../models/index.js';
import { addDays } from '../utils/dates.js';
import { logger } from '../utils/logger.js';

const EXPENSES = [
  { category: 'food', merchant: 'Local cafe', min: 120, max: 480 },
  { category: 'groceries', merchant: 'BigBasket', min: 400, max: 1800 },
  { category: 'transport', merchant: 'Rapido', min: 60, max: 260 },
  { category: 'bills', merchant: 'Electricity', min: 700, max: 1600 },
  { category: 'entertainment', merchant: 'Netflix', min: 199, max: 649 },
  { category: 'shopping', merchant: 'Myntra', min: 800, max: 3200 }
];

const MEALS = [
  {
    mealType: 'breakfast',
    items: [
      { name: 'Poha', quantity: '1 bowl', calories: 250, protein: 5, carbs: 45, fat: 6 },
      { name: 'Tea', quantity: '1 cup', calories: 90, protein: 2, carbs: 12, fat: 3 }
    ]
  },
  {
    mealType: 'lunch',
    items: [
      { name: 'Roti', quantity: '2', calories: 240, protein: 8, carbs: 44, fat: 3 },
      { name: 'Dal', quantity: '1 bowl', calories: 180, protein: 11, carbs: 26, fat: 4 },
      { name: 'Paneer sabzi', quantity: '1 bowl', calories: 310, protein: 16, carbs: 12, fat: 22 }
    ]
  },
  {
    mealType: 'dinner',
    items: [
      { name: 'Rice', quantity: '1 bowl', calories: 200, protein: 4, carbs: 44, fat: 1 },
      { name: 'Rajma', quantity: '1 bowl', calories: 240, protein: 13, carbs: 38, fat: 4 }
    ]
  },
  {
    mealType: 'snack',
    items: [{ name: 'Banana', quantity: '1', calories: 105, protein: 1, carbs: 27, fat: 0 }]
  }
];

const INVESTMENTS = [
  { type: 'sip', instrument: 'Parag Parikh Flexi Cap', amount: 10000 },
  { type: 'liquid_fund', instrument: 'ICICI Liquid Fund', amount: 30000 },
  { type: 'gold', instrument: 'Sovereign Gold Bond', amount: 5000 }
];

const between = (min, max) => Math.round(min + Math.random() * (max - min));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function seed() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run seed -- your@email.com');
    process.exit(1);
  }

  await connectDatabase();

  const user = await User.findOne({ email });
  if (!user) {
    console.error(`No account found for ${email}. Register in the app first.`);
    await disconnectDatabase();
    process.exit(1);
  }

  await Promise.all([
    Expense.deleteMany({ user: user._id, source: 'manual', note: 'sample data' }),
    Meal.deleteMany({ user: user._id, source: 'manual', note: 'sample data' }),
    Investment.deleteMany({ user: user._id, source: 'manual', note: 'sample data' })
  ]);

  const expenses = [];
  const meals = [];
  const investments = [];

  for (let dayOffset = 45; dayOffset >= 0; dayOffset -= 1) {
    const date = addDays(new Date(), -dayOffset);

    for (let i = 0; i < between(1, 3); i += 1) {
      const template = pick(EXPENSES);
      expenses.push({
        user: user._id,
        amount: between(template.min, template.max),
        category: template.category,
        merchant: template.merchant,
        note: 'sample data',
        date,
        source: 'manual'
      });
    }

    // Skip a few days so the "days logged" figure looks realistic.
    if (Math.random() > 0.15) {
      for (const template of MEALS.slice(0, between(2, 4))) {
        meals.push({ user: user._id, ...template, note: 'sample data', date, source: 'manual' });
      }
    }

    if (date.getDate() === 5) {
      for (const template of INVESTMENTS) {
        investments.push({ user: user._id, ...template, note: 'sample data', date, source: 'manual' });
      }
    }
  }

  await Expense.insertMany(expenses);
  // `create` (not insertMany) so the pre-validate hook fills `totals`.
  await Meal.create(meals);
  await Investment.insertMany(investments);

  if (!user.monthlyBudget) {
    user.monthlyBudget = 25000;
    await user.save();
  }

  logger.info(
    `Seeded ${expenses.length} expenses, ${meals.length} meals, ${investments.length} investments for ${email}`
  );

  await disconnectDatabase();
  process.exit(0);
}

seed().catch(async (error) => {
  logger.error(error.message);
  await disconnectDatabase();
  process.exit(1);
});
