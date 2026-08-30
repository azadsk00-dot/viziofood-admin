// Auth store — Supabase session + profile role. Kitchen tablets sign in with
// a dedicated account whose profiles.role is 'kitchen' (RLS: read orders,
// update workflow fields only). admin/staff accounts also work.

import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '../lib/types';
import { supabase } from '../lib/supabase';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  userId: string | null;
  email: string | null;
  role: UserRole | null;
  fullName: string | null;
  error: string | null;
  setSession: (session: Session | null) => void;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ ok: boolean; error?: string }>;
}

const STAFF_ROLES: UserRole[] = ['admin', 'staff', 'kitchen'];

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  session: null,
  userId: null,
  email: null,
  role: null,
  fullName: null,
  error: null,

  setSession: (session) => {
    if (!session?.user) {
      set({ status: 'signedOut', session: null, userId: null, email: null, role: null, fullName: null, error: null });
      return;
    }
    set({
      status: 'signedIn',
      session,
      userId: session.user.id,
      email: session.user.email ?? null,
      error: null,
    });
    void get().refreshProfile();
  },

  refreshProfile: async () => {
    const userId = get().userId;
    if (!userId) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('role, full_name')
      .eq('id', userId)
      .maybeSingle();
    if (error) return; // profile read failed — keep role null, screens degrade
    const role = ((data as { role?: string } | null)?.role ?? 'customer') as UserRole;
    if (!STAFF_ROLES.includes(role)) {
      // Not a kitchen-capable account: sign out again with a clear error.
      await supabase.auth.signOut();
      set({ status: 'signedOut', session: null, userId: null, role: null, error: 'This account does not have kitchen access.' });
      return;
    }
    set({ role, fullName: (data as { full_name?: string } | null)?.full_name ?? null });
  },

  signIn: async (email, password) => {
    set({ error: null });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      const message = error?.message === 'Invalid login credentials'
        ? 'Wrong email or password.'
        : error?.message === 'Email not confirmed'
          ? 'This account has not been confirmed yet — ask an admin to activate it.'
          : error?.message ?? 'Sign-in failed.';
      set({ error: message });
      return { ok: false, error: message };
    }
    get().setSession(data.session);
    return { ok: true };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ status: 'signedOut', session: null, userId: null, email: null, role: null, fullName: null, error: null });
  },

  resetPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'viziokitchen://reset-password',
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
}));
