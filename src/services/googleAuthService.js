/**
 * Verifies the ID token that "Sign in with Google" hands to the browser.
 *
 * The browser is not trusted. It sends us a signed token; this file checks the
 * signature against Google's public keys and confirms the token was issued for
 * *our* client id. Only then do we believe the email inside it.
 *
 * `google-auth-library` fetches and caches Google's rotating keys for us —
 * this is exactly the kind of code that should not be hand-written.
 */
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

let client = null;

const getClient = () => {
  if (!client) client = new OAuth2Client(env.googleClientId);
  return client;
};

export const isGoogleEnabled = () => env.googleEnabled;

/** Safe to send to the browser: the client id is public by design. */
export const googleStatus = () => ({
  enabled: env.googleEnabled,
  clientId: env.googleClientId
});

/**
 * Turns a Google credential into a trusted profile.
 * Throws an ApiError — never returns partially verified data.
 */
export async function verifyGoogleToken(credential) {
  if (!env.googleEnabled) {
    throw ApiError.unavailable(
      'Google sign-in is not set up. Add GOOGLE_CLIENT_ID to server/.env.'
    );
  }

  let payload;
  try {
    const ticket = await getClient().verifyIdToken({
      idToken: credential,
      audience: env.googleClientId
    });
    payload = ticket.getPayload();
  } catch (error) {
    logger.warn('google token rejected', error.message);
    throw ApiError.unauthorized('That Google sign-in could not be verified. Please try again.');
  }

  if (!payload?.sub || !payload.email) {
    throw ApiError.unauthorized('Google did not return an email address.');
  }

  // Without this an attacker could claim an address they do not own and take
  // over the matching password account.
  if (payload.email_verified === false) {
    throw ApiError.forbidden('Please verify your email with Google before signing in.');
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: (payload.name || payload.email.split('@')[0]).slice(0, 80),
    avatarUrl: (payload.picture || '').slice(0, 500)
  };
}
