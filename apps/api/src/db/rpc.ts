import type { Db } from './supabase';
import { unwrap } from './supabase';

/**
 * Thin seam over "call a SQL function". Routes that only forward to a rules
 * function use this, so the rules stay in Postgres and routes stay easy to test.
 */
export interface Rpc {
  /** a function returning one row (or a scalar) */
  one<T = Record<string, unknown>>(fn: string, args?: Record<string, unknown>): Promise<T>;
  /** a function returning a set of rows */
  many<T = Record<string, unknown>>(fn: string, args?: Record<string, unknown>): Promise<T[]>;
  /** insert one row into a table the server owns (service role) */
  insert(table: string, row: Record<string, unknown>): Promise<void>;
}

export function supabaseRpc(db: Db): Rpc {
  return {
    async one(fn, args = {}) {
      return unwrap(await db.rpc(fn, args).single()) as never;
    },
    async many(fn, args = {}) {
      return (unwrap(await db.rpc(fn, args)) ?? []) as never;
    },
    async insert(table, row) {
      unwrap(await db.from(table).insert(row));
    },
  };
}
