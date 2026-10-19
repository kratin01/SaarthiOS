import mongoose from 'mongoose';

/**
 * A user's link to an outside app such as Swiggy: one row per user and app.
 *
 * Tokens live only in `secret`, encrypted the same way as saved AI keys, and
 * never leave the server. The row outlives a disconnect so orders that were
 * already imported are still recognised after connecting again.
 */
const pendingSchema = new mongoose.Schema(
  {
    /** Only a hash of the OAuth `state` is kept. */
    stateHash: { type: String, required: true },
    returnTo: { type: String, enum: ['settings', 'chat'], default: 'settings' },
    expiresAt: { type: Date, required: true }
  },
  { _id: false }
);

const appConnectionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    app: { type: String, required: true, maxlength: 40 },
    status: {
      type: String,
      enum: ['pending', 'connected', 'expired', 'disconnected'],
      default: 'pending'
    },
    /** The OAuth client SaarthiOS registered with the app. Not secret on its own. */
    oauth: {
      clientId: { type: String, default: '' },
      authMethod: { type: String, default: 'none' },
      tokenEndpoint: { type: String, default: '' },
      redirectUri: { type: String, default: '' },
      resource: { type: String, default: '' }
    },
    /** AES-256-GCM JSON: tokens, any client secret, and the PKCE verifier while signing in. */
    secret: {
      ciphertext: { type: String, default: '' },
      iv: { type: String, default: '' },
      tag: { type: String, default: '' }
    },
    tokenExpiresAt: { type: Date, default: null },
    pending: { type: pendingSchema, default: null },
    connectedAt: { type: Date, default: null },
    lastImportedAt: { type: Date, default: null },
    /** Order ids already turned into records, newest last, so nothing is counted twice. */
    importedOrders: { type: [String], default: [] }
  },
  { timestamps: true }
);

appConnectionSchema.index({ user: 1, app: 1 }, { unique: true });

appConnectionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.secret;
    delete ret.oauth;
    delete ret.pending;
    delete ret.importedOrders;
    delete ret.__v;
    return ret;
  }
});

export const AppConnection = mongoose.model('AppConnection', appConnectionSchema);
