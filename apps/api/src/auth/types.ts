export type Role = 'customer' | 'mechanic' | 'admin';

export interface AuthUser {
  id: string;
  role: Role;
  email?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
