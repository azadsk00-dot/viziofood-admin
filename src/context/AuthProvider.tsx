/**
 * AuthProvider — Supabase session + profile for every surface (customer,
 * admin, kitchen). Extended for the rebuild: customer sign-up (profiles row
 * is auto-created by the handle_new_user trigger), the 'kitchen' role, and
 * named exports for the shared UserRole type (canonical copy in types/).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, supabaseConfigurationError } from '../lib/supabase';
import type { UserRole } from '../types';

export type { UserRole };
export type Profile = { id: string; full_name: string | null; role: UserRole; created_at: string; updated_at: string };

interface AuthValue {
  user: User | null;
  profile: Profile | null;
  role: UserRole | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<Profile>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
  resetPassword: (email: string, redirectTo?: string) => Promise<void>;
}

const Context = createContext<AuthValue | undefined>(undefined);

const friendly = (message: string) =>
  message.includes('Invalid login credentials')
    ? 'Invalid email or password.'
    : message.toLowerCase().includes('network')
      ? 'Network error. Please try again.'
      : message;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    const client = supabase;
    if (!client || !user) {
      setProfile(null);
      return null;
    }
    const { data, error: queryError } = await client
      .from('profiles')
      .select('id,full_name,role,created_at,updated_at')
      .eq('id', user.id)
      .maybeSingle();
    if (queryError) throw queryError;
    const next = data as Profile | null;
    setProfile(next);
    return next;
  }, [user]);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setError(supabaseConfigurationError);
      setLoading(false);
      return;
    }
    let alive = true;
    void client.auth.getSession().then(({ data }) => {
      if (alive) {
        setUser(data.session?.user ?? null);
        setLoading(false);
      }
    });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (alive) {
        setUser(session?.user ?? null);
        if (!session) setProfile(null);
      }
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user) {
      void refreshProfile().catch((reason) =>
        setError(friendly(reason instanceof Error ? reason.message : 'Unable to load your profile.')),
      );
    } else {
      setProfile(null);
    }
  }, [user, refreshProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const client = supabase;
    if (!client) throw new Error(supabaseConfigurationError);
    setError(null);
    const { data, error: authError } = await client.auth.signInWithPassword({ email, password });
    if (authError) throw new Error(friendly(authError.message));
    setUser(data.user);
    const { data: loaded, error: profileError } = await client
      .from('profiles')
      .select('id,full_name,role,created_at,updated_at')
      .eq('id', data.user.id)
      .maybeSingle();
    if (profileError) throw new Error(friendly(profileError.message));
    if (!loaded) throw new Error('Your account profile is not configured.');
    const next = loaded as Profile;
    setProfile(next);
    return next;
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const client = supabase;
    if (!client) throw new Error(supabaseConfigurationError);
    setError(null);
    const { data, error: signUpError } = await client.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (signUpError) throw new Error(friendly(signUpError.message));
    // handle_new_user() trigger creates the profiles row; refresh so the
    // session state settles either way (email confirmation may be required).
    if (data.session) setUser(data.session.user);
  }, []);

  const signOut = useCallback(async () => {
    const client = supabase;
    if (!client) return;
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) throw new Error(friendly(signOutError.message));
    setUser(null);
    setProfile(null);
  }, []);

  const resetPassword = useCallback(async (email: string, redirectTo = `${location.origin}/admin/login`) => {
    const client = supabase;
    if (!client) throw new Error(supabaseConfigurationError);
    const { error: resetError } = await client.auth.resetPasswordForEmail(email, { redirectTo });
    if (resetError) throw new Error(friendly(resetError.message));
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, profile, role: profile?.role ?? null, loading, error, signIn, signUp, signOut, refreshProfile, resetPassword }),
    [user, profile, loading, error, signIn, signUp, signOut, refreshProfile, resetPassword],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useAuth = () => {
  const value = useContext(Context);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
};
