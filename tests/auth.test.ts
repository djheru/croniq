// tests/auth.test.ts
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { doubleCsrf } from 'csrf-csrf';
import { authRouter } from '../src/auth/routes';
import * as db from '../src/db';

jest.mock('../src/db');
jest.mock('@simplewebauthn/server');

const mockHasUsers = jest.mocked(db.hasUsers);
const mockFindUserByEmail = jest.mocked(db.findUserByEmail);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser('test'));
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  const { doubleCsrfProtection, generateToken } = doubleCsrf({
    getSecret: () => 'test-csrf', cookieName: '__csrf',
    cookieOptions: { sameSite: 'lax', secure: false },
    getTokenFromRequest: r => r.headers['x-csrf-token'] as string,
  });
  app.get('/api/csrf-token', (req, res) => res.json({ token: generateToken(req, res) }));
  app.use(doubleCsrfProtection);
  app.use(authRouter);
  return app;
}

describe('GET /api/auth/status', () => {
  it('returns hasUsers: false when no users exist', async () => {
    mockHasUsers.mockReturnValue(false);
    const app = buildApp();
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasUsers: false });
  });

  it('returns hasUsers: true when users exist', async () => {
    mockHasUsers.mockReturnValue(true);
    const app = buildApp();
    const res = await request(app).get('/api/auth/status');
    expect(res.body).toEqual({ hasUsers: true });
  });
});

describe('POST /api/auth/register/options', () => {
  it('rejects missing email', async () => {
    const app = buildApp();
    const csrf = await request(app).get('/api/csrf-token');
    const res = await request(app)
      .post('/api/auth/register/options')
      .set('Cookie', csrf.headers['set-cookie'])
      .set('x-csrf-token', csrf.body.token)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/recover', () => {
  it('rejects missing fields', async () => {
    const app = buildApp();
    const csrf = await request(app).get('/api/csrf-token');
    const res = await request(app)
      .post('/api/auth/recover')
      .set('Cookie', csrf.headers['set-cookie'])
      .set('x-csrf-token', csrf.body.token)
      .send({ email: 'test@example.com' }); // missing recoveryCode
    expect(res.status).toBe(400);
  });

  it('rejects wrong recovery code', async () => {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('correct-code', 10);
    mockFindUserByEmail.mockReturnValue({ id: 'u1', email: 'test@example.com', recovery_code_hash: hash } as any);
    const app = buildApp();
    const csrf = await request(app).get('/api/csrf-token');
    const res = await request(app)
      .post('/api/auth/recover')
      .set('Cookie', csrf.headers['set-cookie'])
      .set('x-csrf-token', csrf.body.token)
      .send({ email: 'test@example.com', recoveryCode: 'wrong-code' });
    expect(res.status).toBe(400);
  });
});
