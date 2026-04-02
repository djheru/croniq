import { Router, type Request } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import {
  generateRegistrationOptions, generateAuthenticationOptions,
  verifyRegistrationResponse, verifyAuthenticationResponse,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import {
  createUser, findUserByEmail, findUserById,
  getPasskeysByUser, getPasskeyById, savePasskey, updatePasskeyCounter,
  renamePasskey, deletePasskey, storeChallenge, consumeChallenge,
  setRecoveryCodeHash, logAuditEvent, hasUsers,
} from '../db.js';

const RP_NAME = 'Croniq';
const RP_ID = process.env.RP_ID ?? 'localhost';
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5173';

const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
}

export const authRouter = Router();

// GET /api/auth/status — unauthenticated (no CSRF needed for GET)
authRouter.get('/api/auth/status', (req, res) => {
  res.json({ hasUsers: hasUsers() });
});

// ===== REGISTRATION =====
authRouter.post('/api/auth/register/options', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Valid email required' });
  const normalizedEmail = email.toLowerCase().trim();
  let user = findUserByEmail(normalizedEmail);
  if (!user) {
    user = createUser(randomUUID(), normalizedEmail, randomBytes(32));
  }
  const existingPasskeys = getPasskeysByUser(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID: RP_ID,
    userName: user.email, userDisplayName: user.email,
    userID: new Uint8Array(user.webauthn_user_id),
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map(pk => ({ id: pk.id, transports: pk.transports ? JSON.parse(pk.transports) : undefined })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  storeChallenge(options.challenge, user.id, 'registration');
  res.json(options);
});

authRouter.post('/api/auth/register/verify', authLimiter, async (req, res) => {
  try {
    const clientDataJSON = JSON.parse(Buffer.from(req.body.response.clientDataJSON, 'base64url').toString());
    const challengeRecord = consumeChallenge(clientDataJSON.challenge, 'registration');
    if (!challengeRecord) return res.status(400).json({ verified: false, error: 'Invalid or expired challenge' });
    const user = findUserById(challengeRecord.user_id);
    if (!user) return res.status(400).json({ verified: false });

    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: clientDataJSON.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ verified: false });

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    savePasskey(credential.id, user.id, Buffer.from(credential.publicKey), credential.counter, credentialDeviceType, credentialBackedUp, credential.transports);
    logAuditEvent(user.id, 'registered', `passkey: ${credential.id.substring(0, 16)}…`, getClientIp(req));

    const allPasskeys = getPasskeysByUser(user.id);
    let recoveryCode: string | undefined;
    if (allPasskeys.length === 1) {
      recoveryCode = randomBytes(32).toString('base64url');
      const hash = await bcrypt.hash(recoveryCode, 10);
      setRecoveryCodeHash(user.id, hash);
    }

    (req.session as any).userId = user.id;
    res.json({ verified: true, recoveryCode });
  } catch (err) {
    logAuditEvent(null, 'registration.error', String(err), getClientIp(req));
    return res.status(400).json({ verified: false, error: err instanceof Error ? err.message : 'Registration failed' });
  }
});

// ===== LOGIN =====
authRouter.post('/api/auth/login/options', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Valid email required' });
  const user = findUserByEmail(email.toLowerCase().trim());
  if (!user) {
    const dummy = await generateAuthenticationOptions({ rpID: RP_ID, allowCredentials: [], userVerification: 'required' });
    storeChallenge(dummy.challenge, 'nonexistent-user', 'authentication');
    return res.json(dummy);
  }
  const passkeys = getPasskeysByUser(user.id);
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: passkeys.map(pk => ({ id: pk.id, transports: pk.transports ? JSON.parse(pk.transports) : undefined })),
    userVerification: 'required',
  });
  storeChallenge(options.challenge, user.id, 'authentication');
  res.json(options);
});

authRouter.post('/api/auth/login/verify', authLimiter, async (req, res) => {
  try {
    const clientDataJSON = JSON.parse(Buffer.from(req.body.response.clientDataJSON, 'base64url').toString());
    const challengeRecord = consumeChallenge(clientDataJSON.challenge, 'authentication');
    if (!challengeRecord) return res.status(400).json({ verified: false, error: 'Invalid or expired challenge' });
    const user = findUserById(challengeRecord.user_id);
    if (!user) return res.status(400).json({ verified: false });
    const passkey = getPasskeyById(req.body.id);
    if (!passkey || passkey.user_id !== user.id) return res.status(400).json({ verified: false });

    const credential: WebAuthnCredential = {
      id: passkey.id, publicKey: new Uint8Array(passkey.public_key),
      counter: passkey.counter, transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
    };
    const verification = await verifyAuthenticationResponse({
      response: req.body, expectedChallenge: clientDataJSON.challenge,
      expectedOrigin: ORIGIN, expectedRPID: RP_ID,
      credential, requireUserVerification: true,
    });
    if (!verification.verified) return res.status(400).json({ verified: false });
    updatePasskeyCounter(passkey.id, verification.authenticationInfo.newCounter, new Date().toISOString());
    (req.session as any).userId = user.id;
    logAuditEvent(user.id, 'logged_in', `passkey: ${passkey.id.substring(0, 16)}…`, getClientIp(req));
    res.json({ verified: true });
  } catch (err) {
    return res.status(400).json({ verified: false, error: err instanceof Error ? err.message : 'Authentication failed' });
  }
});

// ===== RECOVERY =====
authRouter.post('/api/auth/recover', authLimiter, async (req, res) => {
  const { email, recoveryCode } = req.body;
  if (!email || !recoveryCode) return res.status(400).json({ error: 'Email and recovery code required' });
  const user = findUserByEmail(email.toLowerCase().trim());
  if (!user || !user.recovery_code_hash) return res.status(400).json({ error: 'Recovery failed.' });
  const valid = await bcrypt.compare(recoveryCode, user.recovery_code_hash);
  if (!valid) return res.status(400).json({ error: 'Recovery failed.' });

  const newCode = randomBytes(32).toString('base64url');
  const newHash = await bcrypt.hash(newCode, 10);
  setRecoveryCodeHash(user.id, newHash);
  (req.session as any).userId = user.id;
  logAuditEvent(user.id, 'recovered', '', getClientIp(req));
  res.json({ ok: true, newRecoveryCode: newCode });
});

// ===== SESSION / ME =====
authRouter.post('/api/auth/logout', (req, res) => {
  const userId = (req.session as any).userId;
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    logAuditEvent(userId ?? null, 'logged_out', '', getClientIp(req));
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

authRouter.get('/api/me', (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const user = findUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const passkeys = getPasskeysByUser(user.id);
  res.json({
    id: user.id, email: user.email,
    passkeys: passkeys.map(pk => ({
      id: pk.id, label: pk.label, deviceType: pk.device_type,
      backedUp: pk.backed_up === 1, createdAt: pk.created_at, lastUsedAt: pk.last_used_at,
    })),
  });
});

// ===== PASSKEY MANAGEMENT =====
authRouter.get('/api/passkeys', (req, res) => {
  const passkeys = getPasskeysByUser((req.session as any).userId);
  res.json(passkeys.map(pk => ({ id: pk.id, label: pk.label, deviceType: pk.device_type, backedUp: pk.backed_up === 1, createdAt: pk.created_at, lastUsedAt: pk.last_used_at })));
});

authRouter.post('/api/passkeys', async (req, res) => {
  const user = findUserById((req.session as any).userId)!;
  const existingPasskeys = getPasskeysByUser(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID: RP_ID,
    userName: user.email, userDisplayName: user.email,
    userID: new Uint8Array(user.webauthn_user_id),
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map(pk => ({ id: pk.id })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  storeChallenge(options.challenge, user.id, 'registration');
  res.json(options);
});

authRouter.post('/api/passkeys/verify', async (req, res) => {
  try {
    const clientDataJSON = JSON.parse(Buffer.from(req.body.response.clientDataJSON, 'base64url').toString());
    const challengeRecord = consumeChallenge(clientDataJSON.challenge, 'registration');
    if (!challengeRecord || challengeRecord.user_id !== (req.session as any).userId) return res.status(400).json({ verified: false });
    const user = findUserById(challengeRecord.user_id)!;
    const verification = await verifyRegistrationResponse({ response: req.body, expectedChallenge: clientDataJSON.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID });
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ verified: false });
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    savePasskey(credential.id, user.id, Buffer.from(credential.publicKey), credential.counter, credentialDeviceType, credentialBackedUp, credential.transports);
    logAuditEvent(user.id, 'passkey_added', credential.id.substring(0, 16), getClientIp(req));
    res.json({ verified: true });
  } catch (err) {
    res.status(400).json({ verified: false, error: err instanceof Error ? err.message : 'Failed' });
  }
});

authRouter.patch('/api/passkeys/:id', (req, res) => {
  const { label } = req.body;
  if (!label || typeof label !== 'string' || label.length > 64) return res.status(400).json({ error: 'Label required (max 64 chars)' });
  renamePasskey(req.params.id, (req.session as any).userId, label.trim());
  logAuditEvent((req.session as any).userId, 'passkey_renamed', req.params.id.substring(0, 16), getClientIp(req));
  res.json({ ok: true });
});

authRouter.delete('/api/passkeys/:id', (req, res) => {
  const userId = (req.session as any).userId;
  const existing = getPasskeysByUser(userId);
  if (existing.length <= 1) return res.status(400).json({ error: 'Cannot delete your only passkey' });
  const deleted = deletePasskey(req.params.id, userId);
  if (!deleted) return res.status(404).json({ error: 'Passkey not found' });
  logAuditEvent(userId, 'passkey_deleted', req.params.id.substring(0, 16), getClientIp(req));
  res.json({ ok: true });
});

authRouter.post('/api/passkeys/recovery-code/regenerate', async (req, res) => {
  const userId = (req.session as any).userId;
  const newCode = randomBytes(32).toString('base64url');
  const hash = await bcrypt.hash(newCode, 10);
  setRecoveryCodeHash(userId, hash);
  logAuditEvent(userId, 'recovery_code_regenerated', '', getClientIp(req));
  res.json({ recoveryCode: newCode });
});
