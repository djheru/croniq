declare module 'better-sqlite3-session-store' {
  import { Store, SessionData } from 'express-session';
  import Database from 'better-sqlite3';

  interface SqliteStoreOptions {
    client: Database.Database;
    expired?: {
      clear?: boolean;
      intervalMs?: number;
    };
  }

  interface SqliteStoreConstructor {
    new (options: SqliteStoreOptions): Store;
  }

  function SqliteStore(session: any): SqliteStoreConstructor;

  export = SqliteStore;
}
