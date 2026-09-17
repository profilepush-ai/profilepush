import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface Account {
  id: string;
  name: string;
  owner_id: string;
  credits_balance: number;
  is_trial: boolean;
  active_persona: 'vendor' | 'bench_sales' | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  account_id: string;
  razorpay_subscription_id: string | null;
  plan_credits: number;
  status: 'pending' | 'active' | 'halted' | 'cancelled' | 'completed' | 'inactive';
  current_period_start: string | null;
  current_period_end: string | null;
  pending_plan_credits: number | null;
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
  accountLoading: boolean;
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
  accountLoading: true,
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
  // Tracks specifically whether the initial post-auth account fetch is in
  // flight — distinct from `loading` (which only flips false once, on the
  // very first INITIAL_SESSION event). Right after a fresh signup's
  // SIGNED_IN event, `loading` can already be false while `account` is
  // still null; ProtectedRoute needs this to tell "not fetched yet" apart
  // from "fetched, no persona set" so it doesn't flash the persona gate.
  const [accountLoading, setAccountLoading] = useState(true);

  // There's no DB trigger that provisions accounts/account_members on
  // signup (see account-provisioning.ts) — every signup/sign-in flow
  // creates that row itself, client-side, *after* the auth session already
  // exists. That session change fires this same loadAccount (via the
  // onAuthStateChange listener below) immediately, which can race ahead of
  // those inserts and find no membership yet. Without a retry, that single
  // early "not found" result becomes the final state — and since
  // ProtectedRoute's persona gate only fires when `account` is truthy, a
  // stuck-null account bypasses the gate entirely instead of showing it,
  // dropping a brand-new signup straight into a persona-less app. Retrying
  // a few times gives the real insert time to land before concluding the
  // user genuinely has no account (e.g. an invite-pending case).
  const loadAccount = useCallback(async (u: User, attempt = 0): Promise<void> => {
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

    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await loadAccount(u, attempt + 1);
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
    // supabase-js re-checks (and often refreshes) the stored session every
    // time a backgrounded tab becomes visible again, re-emitting SIGNED_IN /
    // TOKEN_REFRESHED for the *same* already-signed-in user. Treating those
    // like a fresh sign-in flipped `accountLoading` back on, and
    // ProtectedRoute's full-screen spinner unmounts the entire page tree —
    // so switching to another tab and back looked like a full page refresh
    // and dropped the user's place (scroll, filters, open panels, and any
    // route the guards then redirected away from). The account is therefore
    // only (re)loaded when the signed-in identity actually changes.
    let loadedUserId: string | null = null;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      const nextUser = s?.user ?? null;
      setSession(s);
      // Preserve the User object identity across token refreshes too, so
      // effects elsewhere that depend on `user` don't re-fire on tab focus.
      setUser((previous) => (previous && nextUser && previous.id === nextUser.id ? previous : nextUser));

      const isSameUser = nextUser != null && nextUser.id === loadedUserId;
      loadedUserId = nextUser?.id ?? null;

      // USER_UPDATED is a real profile change, so it still refetches.
      if (isSameUser && event !== 'USER_UPDATED') {
        if (event === 'INITIAL_SESSION') setLoading(false);
        return;
      }

      setAccountLoading(true);
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
          // Leave the identity unmarked so the next auth event retries the
          // load instead of leaving the account permanently null.
          if (loadedUserId === (s?.user?.id ?? null)) loadedUserId = null;
          setAccount(null);
          setMembership(null);
          setSubscription(null);
        } finally {
          if (event === 'INITIAL_SESSION') setLoading(false);
          setAccountLoading(false);
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
    () => ({ user, session, account, membership, subscription, loading, accountLoading, refreshAccount, signOut }),
    [user, session, account, membership, subscription, loading, accountLoading, refreshAccount, signOut],
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
