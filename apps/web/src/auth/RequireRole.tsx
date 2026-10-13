import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '@/ui/Feedback';
import { homeFor, useAuth, type Role } from './AuthProvider';

/**
 * Route guard. This only decides what to *show*; what a user can actually read
 * or change is enforced by RLS and the API, so bypassing this gets nothing.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session, profile, loading } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div className="container-x py-24">
        <Spinner label="Signing you in" />
      </div>
    );
  }
  if (!session) return <Navigate to="/signin" replace state={{ from: loc.pathname }} />;
  if (!profile) {
    return (
      <div className="container-x py-24">
        <p className="display text-3xl">We could not load your profile.</p>
        <p className="mt-2 text-muted">Try signing out and in again.</p>
      </div>
    );
  }
  if (!roles.includes(profile.role)) return <Navigate to={homeFor(profile)} replace />;

  // customers finish the three onboarding steps once
  if (profile.role === 'customer' && !profile.onboarded_at && loc.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}
