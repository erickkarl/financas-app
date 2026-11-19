// Adaptador de teste: node:sqlite (embutido no Node) com a mesma interface Db do expo-sqlite.
import type { Db, SqlValue } from '../data/db';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...p: SqlValue[]): unknown; all(...p: SqlValue[]): unknown[]; get(...p: SqlValue[]): unknown };
  };
};

export function createNodeDb(): Db {
  const db = new DatabaseSync(':memory:');
  let depth = 0;
  return {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, params = []) {
      return db.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params).map((r) => ({ ...(r as object) })) as T[];
    },
    async getFirstAsync<T>(sql: string, params: SqlValue[] = []) {
      const r = db.prepare(sql).get(...params);
      return (r ? { ...(r as object) } : null) as T | null;
    },
    async withTransactionAsync(task) {
      if (depth > 0) return task();
      depth++;
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
