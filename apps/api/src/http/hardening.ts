import { randomUUID } from 'crypto';
import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

/** A request id on every response and in every log line, so a customer report can be traced. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  (req as unknown as { id: string }).id = id;
  next();
};

/** One JSON line per request: no bodies, no tokens. */
export function accessLog(write: (line: string) => void = (l) => console.log(l)): RequestHandler {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      write(
        JSON.stringify({
          at: new Date().toISOString(),
          id: (req as unknown as { id?: string }).id,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
          user: req.user?.id,
        }),
      );
    });
    next();
  };
}

const keyOf = (req: { user?: { id: string }; ip?: string }) => req.user?.id ?? req.ip ?? 'anon';

/** Limits are per signed-in user where we know them, otherwise per IP. */
export function limiter(opts: { windowMs: number; max: number; message?: string }): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => keyOf(req as never),
    message: { error: 'rate_limited', message: opts.message ?? 'Too many requests, slow down a little.' },
    validate: { trustProxy: false, xForwardedForHeader: false },
  });
}

export const globalLimiter = limiter({ windowMs: 60_000, max: 300 });
/** creating bookings, entering UTRs and answering offers are the abuse-prone writes */
export const writeLimiter = limiter({ windowMs: 60_000, max: 30, message: 'Too many actions in a minute.' });
export const bookingCreateLimiter = limiter({ windowMs: 10 * 60_000, max: 10, message: 'Too many bookings in a short time.' });
