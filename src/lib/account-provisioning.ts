import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

// There is no DB trigger that provisions an accounts/account_members row on
// auth.users insert — every client-side flow that can produce a brand-new
// authenticated user (web email/password signup, web Google Identity
// Services, native Google via the system-browser deep link) is responsible
// for calling this itself. A user who authenticates without ever reaching
// this ends up as an orphaned auth.users row with an active session but no
// account — invisible in the admin Account Stats table (which lists
// accounts, not raw signups) and unable to use any account-scoped feature.
export async function ensureAccountForUser(user: User): Promise<void> {
  const { data: existingMember } = await supabase
    .from('account_members')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (existingMember) return;

  const accountId = crypto.randomUUID();
  const displayName = (user.user_metadata?.full_name ?? user.user_metadata?.name ?? '').trim();
  const businessName = displayName || (user.email?.split('@')[0] ?? 'My Workspace');

  const { error: accountError } = await supabase
    .from('accounts')
    .insert({ id: accountId, name: businessName, owner_id: user.id });

  if (accountError) return;

  await supabase.from('account_members').insert({
    account_id: accountId,
    user_id: user.id,
    invited_email: user.email!,
    role: 'owner',
    status: 'active',
  });
}
