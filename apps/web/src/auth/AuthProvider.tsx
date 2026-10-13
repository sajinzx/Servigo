import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

export type Role = 'customer' | 'mechanic' | 'admin';

export interface Profile {
  id: string;
  role: Role;
  full_name: string | null;
  phone: string | null;
  phone_verified: boolean;
  whatsapp_opt_in: boolean;
  onboarded_at: string | null;
}

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  configured: boolean;
  signInWithGoogle(): Promise<void>;
  sendPhoneOtp(phone: string): Promise<void>;
  verifyPhoneOtp(phone: string, token: string): Promise<void>;
  /** for an already signed-in user (e.g. Google): attach and verify a phone on the SAME account */
  startPhoneLink(phone: string): Promise<void>;
  confirmPhoneLink(phone: string, token: string): Promise<void>;
  signInWithEmail(email: string, password: string): Promise<void>;
  signUpWithEmail(email: string, password: string, name: string): Promise<void>;
  signOut(): Promise<void>;
  refreshProfile(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

const PROFILE_COLUMNS = 'id, role, full_name, phone, phone_verified, whatsapp_opt_in, onboarded_at';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!supabase || !s) {
      setProfile(null);
      return;
    }
    // the profile row is created by a database trigger; give it a moment on first sign-in
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', s.user.id).maybeSingle();
      if (data) {
        setProfile(data as Profile);
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    setProfile(null);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      void loadProfile(s);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      configured: Boolean(supabase),
      async signInWithGoogle() {
        const { error } = await supabase!.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
      },
      async sendPhoneOtp(phone) {
        const { error } = await supabase!.auth.signInWithOtp({ phone });
        if (error) throw error;
      },
      async verifyPhoneOtp(phone, token) {
        const { error } = await supabase!.auth.verifyOtp({ phone, token, type: 'sms' });
        if (error) throw error;
      },
      async startPhoneLink(phone) {
        const { error } = await supabase!.auth.updateUser({ phone });
        if (error) throw error;
      },
      async confirmPhoneLink(phone, token) {
        const { error } = await supabase!.auth.verifyOtp({ phone, token, type: 'phone_change' });
        if (error) throw error;
        await loadProfile(session);
      },
      async signInWithEmail(email, password) {
        const { error } = await supabase!.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signUpWithEmail(email, password, name) {
        const { error } = await supabase!.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
        });
        if (error) throw error;
      },
      async signOut() {
        await supabase?.auth.signOut();
      },
      async refreshProfile() {
        await loadProfile(session);
      },
    }),
    [session, profile, loading, loadProfile],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** Where a signed-in user belongs when they open the app. */
export function homeFor(profile: Profile | null): string {
  if (!profile) return '/signin';
  if (profile.role === 'admin') return '/admin';
  if (profile.role === 'mechanic') return '/mechanic';
  return profile.onboarded_at ? '/garage' : '/onboarding';
}
