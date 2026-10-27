import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiFailure } from './api';

export interface CurrentUser {
  id: string;
  kind: 'customer' | 'staff' | 'admin';
  fullName: string;
  mobile: string | null;
  email: string | null;
  username: string | null;
  nationalId: string | null;
  profileState?: {complete:boolean;missing:string[];profile:any};
  mobileVerified: boolean;
  status: string;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  roleCode: string | null;
  roleName: string | null;
  permissions: string[] | '*';
}

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  refresh: () => Promise<CurrentUser | null>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  setUser: (user: CurrentUser | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ data: CurrentUser }>('/api/auth/me');
      setUser(res.data);
      return res.data;
    } catch (err) {
      if (err instanceof ApiFailure && (err.status === 401 || err.status === 403)) setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* ignore network errors on logout */
    }
    setUser(null);
  }, []);

  const can = useCallback((permission: string) => {
    if (!user) return false;
    if (user.kind === 'customer') return false;
    if (user.permissions === '*') return true;
    if (user.permissions.includes(permission)) return true;
    const [resource] = permission.split('.');
    return user.permissions.includes(`${resource}.*`);
  }, [user]);

  const value = useMemo<AuthState>(() => ({ user, loading, refresh, logout, can, setUser }), [user, loading, refresh, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Landing route for each kind of account. */
export function homeFor(user: CurrentUser | null): string {
  if (!user) return '/login';
  if (user.kind === 'customer') return user.profileState?.complete === false ? '/app/profile' : '/app';
  if (user.kind === 'admin') return '/admin';
  if (user.roleCode === 'accountant') return '/staff/accounting';
  return '/staff';
}
