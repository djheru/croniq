import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import SqliteStore from 'better-sqlite3-session-store';
import Database from 'better-sqlite3';
import { doubleCsrf } from 'csrf-csrf';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
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

// Trust proxy - required for HTTPS behind nginx/reverse proxy
app.set('trust proxy', 1);

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const IS_PROD = process.env.NODE_ENV === 'production';
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? (IS_PROD ? 'https://croniq.local' : 'http://localhost:5173');
const DATA_DIR = process.env.DATA_DIR ?? './data';

// --- Session Store Setup ---
const SessionStore = SqliteStore(session);
fs.mkdirSync(DATA_DIR, { recursive: true });
const sessionDb = new Database(path.join(DATA_DIR, 'sessions.db'));

// --- Middleware ---
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  exposedHeaders: ['set-cookie']
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(process.env.SESSION_SECRET));

app.use(session({
  store: new SessionStore({
    client: sessionDb,
    expired: {
      clear: true,
      intervalMs: 15 * 60 * 1000 // Clean up expired sessions every 15 minutes
    }
  }),
  secret: process.env.SESSION_SECRET!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 30 * 24 * 60 * 60 * 1000
    // Don't set domain - let browser infer it from the request origin
  },
}));

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET!,
  cookieName: '__csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: IS_PROD
    // Don't set domain - let browser infer it from the request origin
  },
  getTokenFromRequest: req => req.headers['x-csrf-token'] as string,
});

app.get('/api/csrf-token', (req, res) => res.json({ token: generateToken(req, res, true) }));

// Apply CSRF protection to all routes except auth endpoints
const CSRF_EXEMPT_PATHS = ['/api/auth/', '/api/csrf-token', '/api/health'];
app.use((req, res, next) => {
  if (CSRF_EXEMPT_PATHS.some(p => req.path.startsWith(p))) return next();
  doubleCsrfProtection(req, res, next);
});

// --- Rate limiting (global) ---
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));

// --- Session guard for /api/* except public paths ---
const PUBLIC_API_PATHS = ['/auth/', '/csrf-token', '/health'];
app.use('/api', (req, res, next) => {
  if (PUBLIC_API_PATHS.some(p => req.path.startsWith(p))) return next();
  if (!req.session.userId) {
    console.log('[auth] 401 Unauthorized - No session userId for:', req.method, req.path);
    console.log('[auth] Session ID:', req.sessionID);
    console.log('[auth] Session data:', req.session);
    return res.status(401).json({ error: 'Unauthorized' });
  }
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
