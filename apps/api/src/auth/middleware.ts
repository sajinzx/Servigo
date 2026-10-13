import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError } from '../http/errors';
import type { Role } from './types';

export interface AuthDeps {
  /** Supabase project JWT secret. If missing, every protected route refuses to run. */
  jwtSecret?: string;
  /** Looks up profiles.role for a verified user id. null means no profile yet. */
  lookupRole(userId: string): Promise<Role | null>;
}

interface SupabaseClaims extends jwt.JwtPayload {
  sub?: string;
  email?: string;
  role?: string;
}

export function authenticate(deps: AuthDeps): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!deps.jwtSecret) {
        throw new HttpError(500, 'auth is not configured', 'auth_unconfigured');
      }
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        throw new HttpError(401, 'missing bearer token', 'unauthenticated');
      }
      let claims: SupabaseClaims;
      try {
        claims = jwt.verify(header.slice(7), deps.jwtSecret, {
          algorithms: ['HS256'],
          audience: 'authenticated',
        }) as SupabaseClaims;
      } catch {
        throw new HttpError(401, 'invalid or expired token', 'unauthenticated');
      }
      if (!claims.sub) throw new HttpError(401, 'token has no subject', 'unauthenticated');

      // the role always comes from the profiles table, never from the token
      const role = await deps.lookupRole(claims.sub);
      if (!role) throw new HttpError(403, 'profile not found', 'no_profile');

      req.user = { id: claims.sub, role, email: claims.email };
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'not signed in', 'unauthenticated'));
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, 'your role cannot do this', 'forbidden'));
    }
    next();
  };
}
