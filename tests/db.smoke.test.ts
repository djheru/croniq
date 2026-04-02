// tests/db.smoke.test.ts
import { createUser, findUserByEmail, hasUsers, resetForTesting } from '../src/db';

beforeEach(() => resetForTesting());

describe('DB query smoke tests', () => {
  it('hasUsers returns false on empty DB', () => {
    expect(hasUsers()).toBe(false);
  });

  it('createUser + findUserByEmail round-trips', () => {
    createUser('u1', 'test@example.com', Buffer.from('webauthn-id'));
    const user = findUserByEmail('test@example.com');
    expect(user).toBeDefined();
    expect(user!.email).toBe('test@example.com');
    expect(hasUsers()).toBe(true);
  });

  it('second test still sees empty DB (resetForTesting works)', () => {
    expect(hasUsers()).toBe(false);
  });
});
