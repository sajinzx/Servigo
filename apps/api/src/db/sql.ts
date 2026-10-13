/**
 * The smallest surface the worker needs from a Postgres client. `pg.Pool`
 * satisfies it in production and PGlite satisfies it in tests, so the worker's
 * real SQL is what the tests run.
 */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
