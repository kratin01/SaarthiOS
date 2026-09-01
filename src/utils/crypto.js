/**
 * Encrypts the API keys users save in Settings.
 *
 * AES-256-GCM: the tag means a tampered ciphertext fails to decrypt rather than
 * producing garbage. Each value gets its own random IV.
 *
 * The master key comes from ENCRYPTION_KEY, or is derived from JWT_SECRET when
 * that is not set. Changing whichever one is in use makes saved keys
 * unreadable — users then simply re-enter them in Settings.
 */
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

let masterKey = null;

function getMasterKey() {
  if (masterKey) return masterKey;
  const secret = env.ENCRYPTION_KEY || env.JWT_SECRET;
  masterKey = crypto.scryptSync(secret, 'saarthios.apikey.v1', 32);
  return masterKey;
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

/** Returns null rather than throwing — a stale secret should not crash a request. */
export function decryptSecret({ ciphertext, iv, tag }) {
  if (!ciphertext || !iv || !tag) return null;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getMasterKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** `AQ.Ab8…5xKq` — enough to recognise a key, not enough to use it. */
export function maskSecret(plain) {
  if (!plain) return '';
  if (plain.length <= 10) return '••••';
  return `${plain.slice(0, 5)}…${plain.slice(-4)}`;
}
