import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface Account {
  id: string;
  name: string;
  owner_id: string;
  credits_balance: number;
  is_trial: boolean;
}

export interface Subscription {
  id: string;
  account_id: string;
  razorpay_subscription_id: string | null;
  plan_amount_usd: number;
  status: 'pending' | 'active' | 'halted' | 'cancelled' | 'completed' | 'inactive';
  current_period_start: string | null;
  current_period_end: string | null;
  pending_plan_amount_usd: number | null;
  cancel_at_period_end: boolean;
}

interface AccountMember {
  id: string;
  account_id: string;
  user_id: string | null;
  invited_email: string;
  display_name: string | null;
  role: 'owner' | 'admin' | 'member';
  status: 'active' | 'invited';
  data_access: 'full' | 'assigned_only';
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  account: Account | null;
  membership: AccountMember | null;
  subscription: Subscription | null;
  loading: boolean;
  refreshAccount: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  account: null,
  membership: null,
  subscription: null,
  loading: true,
  refreshAccount: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [membership, setMembership] = useState<AccountMember | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAccount = useCallback(async (u: User) => {
    const { data: mem } = await supabase
      .from('account_members')
      .select('*')
      .eq('user_id', u.id)
      .eq('status', 'active')
      .maybeSingle();

    if (mem) {
      setMembership(mem as AccountMember);
      const [{ data: acc }, { data: sub }] = await Promise.all([
        supabase.from('accounts').select('*').eq('id', mem.account_id).maybeSingle(),
        supabase.from('subscriptions').select('*').eq('account_id', mem.account_id).maybeSingle(),
      ]);
      setAccount(acc as Account | null);
      setSubscription(sub as Subscription | null);
      return;
    }

    // Claim a pending invite that matches the user's email
    const { data: invite } = await supabase
      .from('account_members')
      .select('*')
      .eq('invited_email', u.email ?? '')
      .eq('status', 'invited')
      .is('user_id', null)
      .maybeSingle();

    if (invite) {
      await supabase
        .from('account_members')
        .update({ user_id: u.id, status: 'active' })
        .eq('id', invite.id);
      await loadAccount(u);
      return;
    }

    setMembership(null);
    setAccount(null);
    setSubscription(null);
  }, []);

  const refreshAccount = useCallback(async () => {
    if (user) await loadAccount(user);
  }, [user, loadAccount]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      (async () => {
        try {
          if (s?.user) {
            await loadAccount(s.user);
          } else {
            setAccount(null);
            setMembership(null);
            setSubscription(null);
          }
        } catch {
          setAccount(null);
          setMembership(null);
          setSubscription(null);
        } finally {
          if (event === 'INITIAL_SESSION') setLoading(false);
        }
      })();
    });

    return () => subscription.unsubscribe();
  }, [loadAccount]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setAccount(null);
    setMembership(null);
    setSubscription(null);
  }, []);

  const value = useMemo(
    () => ({ user, session, account, membership, subscription, loading, refreshAccount, signOut }),
    [user, session, account, membership, subscription, loading, refreshAccount, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
