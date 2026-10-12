import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'resource') => new HttpError(404, `${what} not found`, 'not_found');
export const forbidden = (msg = 'forbidden') => new HttpError(403, msg, 'forbidden');
export const badRequest = (msg: string) => new HttpError(400, msg, 'bad_request');

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'validation_failed',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code ?? 'error', message: err.message });
    return;
  }
  // errors raised by our SQL functions carry a sqlstate in `code`
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
    const code = err.code as string;
    const message = (err as { message?: string }).message ?? 'database error';
    if (code === 'P0001' || code === '23514' || code === '23505') {
      res.status(409).json({ error: 'conflict', message });
      return;
    }
    if (code === '42501') {
      res.status(403).json({ error: 'forbidden', message });
      return;
    }
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: 'something went wrong' });
};
