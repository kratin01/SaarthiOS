import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../models/User.js';

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/saarthios-test';
process.env.JWT_SECRET = 'test-secret-not-used-in-production';
process.env.GOOGLE_CLIENT_ID = 'test-client';
const { register, googleSignIn, updateProfile, updateProfileSchema } = await import('./authController.js');

afterEach(() => mock.restoreAll());

function response() {
  return { status() { return this; }, json(body) { this.body = body; } };
}

test('new password accounts start the tutorial without changing registration response', async () => {
  mock.method(User, 'findOne', () => ({ select: async () => null }));
  mock.method(User, 'hashPassword', async () => 'hashed');
  mock.method(User, 'create', async (input) => new User(input));
  const res = response();
  await register({ body: { name: 'New User', email: 'new@example.test', password: 'password' } }, res, assert.fail);
  assert.equal(res.body.user.tutorialStatus, 'pending');
  assert.ok(res.body.token);
  assert.equal(res.body.user.passwordHash, undefined);
});

test('only newly created Google accounts start a tutorial', async () => {
  mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => ({
    getPayload: () => ({ sub: 'google-id', email: 'google@example.test', name: 'Google User', email_verified: true })
  }));
  mock.method(User, 'findOne', async () => null);
  mock.method(User, 'create', async (input) => new User(input));
  const created = response();
  await googleSignIn({ body: { credential: 'dummy' } }, created, assert.fail);
  assert.equal(created.body.user.tutorialStatus, 'pending');
  const existing = new User({ name: 'Existing User', email: 'google@example.test', googleId: 'google-id' });
  mock.method(User, 'findOne', async () => existing);
  const signedIn = response();
  await googleSignIn({ body: { credential: 'dummy' } }, signedIn, assert.fail);
  assert.equal(signedIn.body.user.tutorialStatus, undefined);
});

test('tutorial completion is a validated profile patch that leaves goals unchanged', async () => {
  const user = new User({ name: 'User', email: 'user@example.test', monthlyBudget: 2000 });
  assert.equal(user.tutorialStatus, undefined);
  mock.method(user, 'save', async () => user);
  for (const tutorialStatus of ['skipped', 'completed']) {
    const body = updateProfileSchema.parse({ tutorialStatus });
    const res = response();
    await updateProfile({ user, body }, res, assert.fail);
    assert.equal(res.body.user.tutorialStatus, tutorialStatus);
    assert.equal(res.body.user.monthlyBudget, 2000);
  }
  assert.equal(updateProfileSchema.safeParse({ tutorialStatus: 'pending' }).success, false);
  assert.equal(updateProfileSchema.safeParse({ tutorialStatus: 'invalid' }).success, false);
});