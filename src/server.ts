import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { doubleCsrf } from 'csrf-csrf';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './db.js';
import { initScheduler } from './scheduler/index.js';
import { authRouter } from './auth/routes.js';
import { apiRouter } from './api/routes.js';

// Session type augmentation
declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

// --- Validate required env ---
if (!process.env.SESSION_SECRET) {
  console.error('[server] SESSION_SECRET env var is required');
  process.exit(1);
}

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const IS_PROD = process.env.NODE_ENV === 'production';
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? (IS_PROD ? 'https://croniq.local' : 'http://localhost:5173');

// --- Middleware ---
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(process.env.SESSION_SECRET));

app.use(session({
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    domain: IS_PROD ? 'croniq.local' : undefined
  },
}));

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET!,
  cookieName: '__csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: IS_PROD,
    domain: IS_PROD ? 'croniq.local' : undefined
  },
  getTokenFromRequest: req => req.headers['x-csrf-token'] as string,
});

app.get('/api/csrf-token', (req, res) => res.json({ token: generateToken(req, res, true) }));
app.use(doubleCsrfProtection);

// --- Rate limiting (global) ---
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));

// --- Session guard for /api/* except public paths ---
const PUBLIC_API_PATHS = ['/auth/', '/csrf-token', '/health'];
app.use('/api', (req, res, next) => {
  if (PUBLIC_API_PATHS.some(p => req.path.startsWith(p))) return next();
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

// --- Routes ---
app.use(authRouter);
app.use('/api', apiRouter);

// --- Static UI (production) ---
if (IS_PROD) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.join(__dirname, '..', 'ui', 'dist')));
  app.get('*', (_, res) => res.sendFile(path.join(__dirname, '..', 'ui', 'dist', 'index.html')));
}

// --- Start ---
initDb();
initScheduler();
app.listen(PORT, () => console.log(`✦ Croniq running on http://localhost:${PORT}`));
