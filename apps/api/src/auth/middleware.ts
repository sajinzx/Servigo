import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from 'jose';
import jwt from 'jsonwebtoken';
import { HttpError } from '../http/errors';
import type { Role } from './types';

export interface AuthDeps {
  /** Legacy Supabase JWT secret (HS256 tokens). */
  jwtSecret?: string;
  /**
   * Key set for projects on Supabase's asymmetric signing keys (ES256 / RS256 tokens).
   * With neither this nor `jwtSecret`, every protected route refuses to run.
   */
  jwks?: JWTVerifyGetKey;
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
      if (!deps.jwtSecret && !deps.jwks) {
        throw new HttpError(500, 'auth is not configured', 'auth_unconfigured');
      }
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        throw new HttpError(401, 'missing bearer token', 'unauthenticated');
      }
      let claims: SupabaseClaims;
      try {
        const token = header.slice(7);
        // the algorithm is read only to choose the key; each path pins the algorithms it accepts,
        // so `alg: none` and HS/RS confusion are both refused
        const alg = decodeProtectedHeader(token).alg;
        if (alg === 'HS256' && deps.jwtSecret) {
          claims = jwt.verify(token, deps.jwtSecret, {
            algorithms: ['HS256'],
            audience: 'authenticated',
          }) as SupabaseClaims;
        } else if ((alg === 'ES256' || alg === 'RS256') && deps.jwks) {
          const { payload } = await jwtVerify(token, deps.jwks, {
            algorithms: ['ES256', 'RS256'],
            audience: 'authenticated',
          });
          claims = payload as SupabaseClaims;
        } else {
          throw new Error('unsupported token');
        }
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
