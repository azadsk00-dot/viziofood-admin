import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, type UserRole } from '../context/AuthProvider';

/**
 * Route guard.
 *
 * Access decisions must distinguish four states, otherwise they create a
 * redirect cycle:
 *   1. session still loading          -> show a holding message (no redirect)
 *   2. not signed in                  -> go to the public login page
 *   3. signed in, profile not loaded  -> show a holding message (no redirect)
 *   4. signed in, role not permitted  -> show access-denied (NEVER redirect)
 *
 * The previous version redirected state 3/4 to "/", but "/" redirects to
 * "/admin", which sent the user straight back here -> infinite loop
 * ("Maximum update depth exceeded"). Every branch below is terminal.
 */
export function ProtectedRoute({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user, profile, role, loading, error } = useAuth();
  const location = useLocation();

  if (loading) return <div className="admin-message">Checking secure access…</div>;

  if (!user) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;

  // Signed in but the profile/role has not resolved yet. Wait instead of
  // treating a transient null role as a denial.
  if (!profile) return <div className="admin-message">{error ?? 'Loading your profile…'}</div>;

  // Signed in with a profile, but the role is missing or not allowed. Render a
  // terminal access-denied view — do not redirect, to avoid any cycle.
  if (!role || !roles.includes(role)) {
    return (
      <main className="admin-access-denied">
        <h1>Access denied</h1>
        <p>{error ?? 'Your account does not have permission to view this page.'}</p>
      </main>
    );
  }

  return <>{children}</>;
}

export const AdminRoute = ({ children }: { children: ReactNode }) => <ProtectedRoute roles={['admin']}>{children}</ProtectedRoute>;
export const StaffRoute = ({ children }: { children: ReactNode }) => <ProtectedRoute roles={['admin', 'staff']}>{children}</ProtectedRoute>;
