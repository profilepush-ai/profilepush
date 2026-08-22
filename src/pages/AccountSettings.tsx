import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building2, Users, User, Shield, CreditCard, AlertTriangle,
  Copy, Check, Plus, Trash2, Pencil, X, Save, Mail,
  Crown, Eye, EyeOff, Lock,
  ArrowRight, ChevronRight, RefreshCw, Info,
  UserCheck, Plug, Loader2,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import LogoSpinner from '../components/LogoSpinner';
import { isGmailFeatureEnabled } from '../lib/gmail-feature-flag';
import { isPaidPlanEffective, shouldShowCreditsUi } from '../lib/feature-gates';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Member {
  id: string; account_id: string; user_id: string | null;
  invited_email: string; display_name: string | null;
  role: 'owner' | 'admin' | 'member'; status: 'active' | 'invited';
  data_access: 'full' | 'assigned_only';
}

type Section = 'billing' | 'profile' | 'workspace' | 'integrations';

type GmailIntegrationStatus = {
  id: string;
  gmail_address: string;
  status: 'connected' | 'disconnected' | 'error' | 'revoked';
  last_error: string | null;
  last_synced_at: string | null;
  connected_at: string;
};

interface WatchSchedule {
  id: string;
  account_id: string;
  profile_id: string | null;
  external_job_post_id?: string | null;
  frequency: 'hourly' | 'daily' | 'twice_daily' | 'weekly';
  is_active: boolean;
  run_status: 'idle' | 'scraping' | 'matching' | 'completed' | 'error';
  last_run_at: string | null;
  updated_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_META: Record<string, { icon: React.ElementType; label: string; cls: string }> = {
  owner:  { icon: Crown,  label: 'Owner',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  admin:  { icon: Shield, label: 'Admin',  cls: 'bg-blue-50 text-blue-700 border-blue-200'   },
  member: { icon: User,   label: 'Member', cls: 'bg-gray-100 text-gray-600 border-gray-200'  },
};

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-violet-500',
  'bg-amber-500', 'bg-rose-500', 'bg-sky-500',
];
const getAvatarColor = (s: string) => AVATAR_COLORS[(s.charCodeAt(0) || 0) % AVATAR_COLORS.length];

const NAV_ITEMS: { id: Section; label: string; icon: React.ElementType; danger?: boolean }[] = [
  { id: 'billing',       label: 'Billing',             icon: CreditCard },
  { id: 'profile',       label: 'Profile',             icon: User      },
  { id: 'workspace',     label: 'Workspace',          icon: Building2 },
  { id: 'integrations',  label: 'Integrations',       icon: Plug      },
];

// ─── Small reusable pieces ─────────────────────────────────────────────────────

function RoleBadge({ role }: { role: 'owner' | 'admin' | 'member' }) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;
  return (
    <span className={`account-settings-label inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border ${meta.cls}`}>
      <Icon size={8} />{meta.label}
    </span>
  );
}

function AccessBadge({ access, locked }: { access: 'full' | 'assigned_only'; locked?: boolean }) {
  if (access === 'full') return (
    <span className="account-settings-label inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
      {locked ? <Lock size={8} /> : <Eye size={8} />}Full Access
    </span>
  );
  return (
    <span className="account-settings-label inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200">
      <EyeOff size={8} />Assigned Only
    </span>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ icon: Icon, title, description, action }: {
  icon?: React.ElementType; title: string; description?: string; action?: React.ReactNode;
}) {
  return (
    <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-center gap-3">
      {Icon && <Icon size={15} className="text-gray-400 shrink-0" />}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AccountSettings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, account, membership, subscription, refreshAccount, signOut } = useAuth();

  const isOwner = membership?.role === 'owner';
  const isPaidPlan = isPaidPlanEffective(subscription);
  const gmailFeatureEnabled = isGmailFeatureEnabled(user?.email);

  // ── Global ──────────────────────────────────────────────────
  const [section, setSection] = useState<Section>(() => {
    const s = searchParams.get('section');
    if (s === 'profile' || s === 'danger') return 'profile';
    if (s === 'workspace' || s === 'team') return 'workspace';
    if (s === 'integrations') return 'integrations';
    return 'billing';
  });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => setToast({ message, type });

  // ── Gmail integration ───────────────────────────────────────
  const [gmailStatus, setGmailStatus] = useState<GmailIntegrationStatus | null>(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [disconnectingGmail, setDisconnectingGmail] = useState(false);

  // ── Watch Schedule ──────────────────────────────────────────
  const [globalWatch, setGlobalWatch] = useState<WatchSchedule | null>(null);
  const [savingWatch, setSavingWatch] = useState(false);

  // ── Members ──────────────────────────────────────────────────
  const [members, setMembers]       = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [copiedId, setCopiedId]     = useState<string | null>(null);

  // ── Workspace ────────────────────────────────────────────────
  const [accountName, setAccountName] = useState('');
  const [savingName, setSavingName]   = useState(false);

  // ── Invite form ──────────────────────────────────────────────
  const [inviteName, setInviteName]   = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState<'admin' | 'member'>('member');
  const [inviteAccess, setInviteAccess] = useState<'full' | 'assigned_only'>('full');
  const [inviting, setInviting]       = useState(false);

  // ── Edit member modal ────────────────────────────────────────
  const [editingMember, setEditingMember]   = useState<Member | null>(null);
  const [editName, setEditName]     = useState('');
  const [editRole, setEditRole]     = useState<'admin' | 'member'>('member');
  const [editAccess, setEditAccess] = useState<'full' | 'assigned_only'>('full');
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Danger ───────────────────────────────────────────────────
  const [confirmLeave, setConfirmLeave]   = useState(false);
  const [leavingWs, setLeavingWs]         = useState(false);
  const [deleteModal, setDeleteModal]     = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deletingWs, setDeletingWs]       = useState(false);

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => {
    if (account)    setAccountName(account.name);
    if (account)    loadMembers();
    if (account)    loadWatchSchedule();
    if (account)    loadGmailStatus();
  }, [account, membership]);

  useEffect(() => {
    const gmailResult = searchParams.get('gmail');
    if (!gmailResult) return;
    if (gmailResult === 'connected') {
      showToast('Gmail connected. You can now send from your own address.', 'success');
      void loadGmailStatus();
    } else {
      showToast('Could not connect Gmail. Please try again.', 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function loadGmailStatus() {
    setGmailLoading(true);
    const { data, error } = await supabase.from('gmail_integration_status').select('*').maybeSingle();
    setGmailLoading(false);
    if (error) return;
    setGmailStatus(data as GmailIntegrationStatus | null);
  }

  async function connectGmail() {
    if (!account?.id || connectingGmail) return;
    setConnectingGmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-oauth-start', { body: { account_id: account.id } });
      if (error || !data?.url) throw new Error(data?.error || 'Could not start Gmail connection');
      window.location.href = data.url;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start Gmail connection', 'error');
      setConnectingGmail(false);
    }
  }

  async function disconnectGmail() {
    if (disconnectingGmail) return;
    setDisconnectingGmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-oauth-disconnect', { body: {} });
      if (error || !data?.ok) throw new Error(data?.error || 'Could not disconnect Gmail');
      await loadGmailStatus();
      showToast('Gmail disconnected', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not disconnect Gmail', 'error');
    } finally {
      setDisconnectingGmail(false);
    }
  }

  async function loadWatchSchedule() {
    if (!account) return;
    const { data, error } = await supabase
      .from('watch_schedules')
      .select('*')
      .eq('account_id', account.id)
      .is('profile_id', null)
      .is('external_job_post_id', null)
      .maybeSingle();

    if (error) {
      showToast('Failed to load watch schedule', 'error');
      return;
    }

    if (data) {
      const normalizedFrequency = isPaidPlan ? data.frequency : 'daily';
      if (!isPaidPlan && data.frequency !== 'daily') {
        await supabase.from('watch_schedules').update({ frequency: 'daily' }).eq('id', data.id);
      }
      setGlobalWatch({ ...data, frequency: normalizedFrequency } as WatchSchedule);
      return;
    }

    const { data: inserted, error: insertError } = await supabase
      .from('watch_schedules')
      .insert({
        account_id: account.id,
        profile_id: null,
        external_job_post_id: null,
        boards: ['linkedin', 'dice', 'indeed', 'monster'],
        frequency: 'daily',
        is_active: true,
        run_status: 'idle',
      })
      .select('*')
      .single();

    if (insertError) {
      showToast('Failed to create watch schedule', 'error');
      return;
    }
    setGlobalWatch(inserted as WatchSchedule);
  }

  async function updateWatchSchedule(patch: Partial<Pick<WatchSchedule, 'is_active' | 'frequency'>>) {
    if (!globalWatch || !canManageWatch) return;
    if (patch.frequency === 'hourly' && !isPaidPlan) {
      showToast('Hourly watch is available on paid plans only', 'error');
      return;
    }

    setSavingWatch(true);
    const updatePayload = {
      ...patch,
      ...(!isPaidPlan ? { frequency: 'daily' as const } : {}),
    };

    const { data, error } = await supabase
      .from('watch_schedules')
      .update(updatePayload)
      .eq('id', globalWatch.id)
      .select('*')
      .single();

    if (error) {
      showToast('Failed to update watch schedule', 'error');
      setSavingWatch(false);
      return;
    }

    const normalizedFrequency = isPaidPlan ? data.frequency : 'daily';
    setGlobalWatch({ ...data, frequency: normalizedFrequency } as WatchSchedule);
    setSavingWatch(false);
    showToast('Watch schedule updated');
  }

  async function loadMembers() {
    if (!account) return;
    setMembersLoading(true);
    const { data } = await supabase
      .from('account_members').select('*')
      .eq('account_id', account.id)
      .order('created_at', { ascending: true });
    setMembers((data ?? []) as Member[]);
    setMembersLoading(false);
  }

  // ── Workspace handlers ────────────────────────────────────────
  async function saveAccountName(e: React.FormEvent) {
    e.preventDefault();
    if (!account || !accountName.trim()) return;
    setSavingName(true);
    const { error } = await supabase.from('accounts')
      .update({ name: accountName.trim() }).eq('id', account.id);
    if (error) showToast('Failed to update name', 'error');
    else { await refreshAccount(); showToast('Workspace name updated'); }
    setSavingName(false);
  }

  // ── Invite handlers ───────────────────────────────────────────
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!account || !inviteEmail.trim()) return;
    const email = inviteEmail.trim().toLowerCase();
    if (members.find(m => m.invited_email.toLowerCase() === email)) {
      showToast('This email is already in your team', 'error'); return;
    }
    setInviting(true);
    const { error } = await supabase.from('account_members').insert({
      account_id: account.id, invited_email: email,
      display_name: inviteName.trim() || null,
      role: inviteRole,
      data_access: inviteRole === 'admin' ? 'full' : inviteAccess,
      status: 'invited', user_id: null,
    });
    if (error) showToast(`Failed to invite: ${error.message}`, 'error');
    else {
      setInviteEmail(''); setInviteName('');
      setInviteRole('member'); setInviteAccess('full');
      showToast(`Invite created for ${email}`);
      await loadMembers();
    }
    setInviting(false);
  }

  function copyInviteLink(m: Member) {
    const msg = `You've been invited to join ${account?.name ?? 'our workspace'} on ProfilePush.\n\nSign up at ${window.location.origin}/signup using this email address: ${m.invited_email}`;
    navigator.clipboard.writeText(msg);
    setCopiedId(m.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // ── Edit member ───────────────────────────────────────────────
  function openEdit(m: Member) {
    setEditingMember(m);
    setEditName(m.display_name ?? '');
    setEditRole(m.role === 'owner' ? 'admin' : (m.role as 'admin' | 'member'));
    setEditAccess(m.role === 'admin' ? 'full' : m.data_access);
  }

  async function saveEdit() {
    if (!editingMember) return;
    setSavingEdit(true);
    const resolvedAccess = editRole === 'admin' ? 'full' : editAccess;
    const { error } = await supabase.from('account_members')
      .update({ display_name: editName.trim() || null, role: editRole, data_access: resolvedAccess })
      .eq('id', editingMember.id);
    if (error) showToast('Failed to save changes', 'error');
    else {
      setMembers(prev => prev.map(m =>
        m.id === editingMember.id
          ? { ...m, display_name: editName.trim() || null, role: editRole, data_access: resolvedAccess }
          : m
      ));
      showToast('Member updated');
      setEditingMember(null);
    }
    setSavingEdit(false);
  }

  async function handleRemove(m: Member) {
    if (m.role === 'owner') return;
    setRemovingId(m.id);
    const { error } = await supabase.from('account_members').delete().eq('id', m.id);
    if (error) showToast('Failed to remove member', 'error');
    else { setMembers(prev => prev.filter(x => x.id !== m.id)); showToast('Member removed'); }
    setRemovingId(null);
  }

  // ── Danger ────────────────────────────────────────────────────
  async function leaveWorkspace() {
    if (!membership || membership.role === 'owner') return;
    setLeavingWs(true);
    const { error } = await supabase.from('account_members').delete().eq('id', membership.id);
    if (error) { showToast('Failed to leave workspace', 'error'); setLeavingWs(false); return; }
    await refreshAccount();
    navigate('/');
  }

  // ── Computed ──────────────────────────────────────────────────
  const activeMembers  = members.filter(m => m.status === 'active');
  const pendingMembers = members.filter(m => m.status === 'invited');
  const displayName    = membership?.display_name || user?.email?.split('@')[0] || 'User';
  const initial        = displayName[0]?.toUpperCase() ?? '?';

  // ─── Plan helpers ──────────────────────────────────────────────
  const planLabel = (() => {
    if (!subscription || subscription.status === 'inactive') return account?.is_trial ? 'Free Trial' : 'Free';
    if (subscription.status === 'active') return `₹${subscription.plan_credits}/mo`;
    return subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1);
  })();
  const planStyle = subscription?.status === 'active'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-gray-50 flex flex-col overscroll-none pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />

      <div className="flex-1 max-w-5xl mx-auto w-full min-w-0 px-3 sm:px-4 py-4 sm:py-8 flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">

        {/* ── Sidebar ── */}
        <aside className="w-full sm:w-52 shrink-0 sm:sticky sm:top-8">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-2">
            <nav className="flex sm:flex-col gap-1 sm:gap-0.5 overflow-x-auto hide-scrollbar">
              {NAV_ITEMS.map(item => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button key={item.id} onClick={() => setSection(item.id)}
                    className={`shrink-0 flex items-center gap-1.5 sm:gap-2.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl text-[11px] sm:text-xs font-medium transition-colors sm:w-full ${
                      active
                        ? item.danger ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-700'
                        : item.danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-600 hover:bg-gray-100'
                    }`}>
                    <Icon size={13} className="shrink-0" />
                    <span className="whitespace-nowrap">{item.label}</span>
                    {active && <ChevronRight size={10} className="ml-auto opacity-50 hidden sm:block" />}
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* ── Content ── */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* ── PROFILE ── */}
          {section === 'profile' && (
            <Card>
              <div className="px-4 sm:px-6 py-5">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl ${getAvatarColor(displayName)} flex items-center justify-center text-white text-xl font-bold shrink-0`}>
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">{displayName}</p>
                    <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      {membership && <RoleBadge role={membership.role} />}
                      {membership && <AccessBadge access={membership.role === 'admin' ? 'full' : membership.data_access} locked={membership.role !== 'member'} />}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 mt-5 pt-4 border-t border-gray-100 text-[11px]">
                  <button onClick={() => void signOut()}
                    className="text-gray-500 hover:text-gray-900 hover:underline underline-offset-2 transition-colors">
                    Logout
                  </button>
                  {isOwner && (
                    <button onClick={() => setDeleteModal(true)}
                      className="text-red-500 hover:text-red-700 hover:underline underline-offset-2 transition-colors">
                      Delete workspace
                    </button>
                  )}
                  {!isOwner && !confirmLeave && (
                    <button onClick={() => setConfirmLeave(true)}
                      className="text-red-500 hover:text-red-700 hover:underline underline-offset-2 transition-colors">
                      Leave workspace
                    </button>
                  )}
                  {!isOwner && confirmLeave && (
                    <span className="flex items-center gap-3">
                      <span className="text-gray-500">Leave this workspace?</span>
                      <button onClick={() => setConfirmLeave(false)} className="text-gray-500 hover:underline">Cancel</button>
                      <button onClick={leaveWorkspace} disabled={leavingWs}
                        className="text-red-500 hover:text-red-700 hover:underline disabled:opacity-50">
                        {leavingWs ? 'Leaving...' : 'Confirm'}
                      </button>
                    </span>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* ── INTEGRATIONS ── */}
          {section === 'integrations' && (
            <Card>
              <CardHeader
                icon={Mail}
                title="Gmail"
                description="Send vendor outreach and inbox replies from your own Gmail address instead of ProfilePush's."
              />
              <div className="px-4 sm:px-6 py-5">
                {!gmailFeatureEnabled ? (
                  <div className="flex items-center gap-3">
                    <span className="shrink-0 px-2 py-1 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold uppercase tracking-wide">Coming Soon</span>
                    <p className="text-xs text-gray-500">We're finishing Google's security review for this feature. It'll be available to everyone shortly.</p>
                  </div>
                ) : gmailLoading ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 size={13} className="animate-spin" />Loading...</div>
                ) : gmailStatus && gmailStatus.status === 'connected' ? (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                        {gmailStatus.gmail_address}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        Connected {new Date(gmailStatus.connected_at).toLocaleDateString()}
                        {gmailStatus.last_synced_at && ` · Last synced ${new Date(gmailStatus.last_synced_at).toLocaleTimeString()}`}
                      </p>
                    </div>
                    <button onClick={() => void disconnectGmail()} disabled={disconnectingGmail}
                      className="shrink-0 px-3 py-1.5 border border-gray-200 hover:bg-gray-50 disabled:opacity-50 text-gray-600 text-xs font-semibold rounded-lg transition-colors">
                      {disconnectingGmail ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                  </div>
                ) : (
                  <div>
                    {gmailStatus && (gmailStatus.status === 'error' || gmailStatus.status === 'revoked') && (
                      <p className="text-[11px] text-red-600 mb-3 flex items-center gap-1"><AlertTriangle size={11} />
                        {gmailStatus.status === 'revoked' ? 'Gmail access was revoked. Reconnect to keep sending from your address.' : (gmailStatus.last_error || 'Gmail connection needs attention.')}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mb-3">Vendors will see replies come from your real Gmail address, not a shared ProfilePush inbox.</p>
                    <button onClick={() => void connectGmail()} disabled={connectingGmail}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-1.5">
                      {connectingGmail ? <LogoSpinner size={13} /> : <Plug size={13} />}Connect Gmail
                    </button>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── WORKSPACE ── */}
          {section === 'workspace' && (
            <>
              <Card>
                <CardHeader icon={Building2} title="Workspace Details" />
                <div className="px-4 sm:px-6 py-5">
                  <form onSubmit={saveAccountName}>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Workspace Name</label>
                    <div className="flex flex-col xs:flex-row gap-2">
                      <input type="text" value={accountName} onChange={e => setAccountName(e.target.value)}
                        disabled={!isOwner}
                        className="min-w-0 flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-500 transition-colors" />
                      {isOwner && (
                        <button type="submit" disabled={savingName || accountName === account?.name}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-1.5">
                          {savingName ? <LogoSpinner size={13} /> : <Save size={13} />}Save
                        </button>
                      )}
                    </div>
                    {!isOwner && <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1"><Info size={9} />Only the owner can change the workspace name</p>}
                  </form>
                </div>
              </Card>
            </>
          )}

          {/* ── TEAM ── */}
          {section === 'workspace' && (
            <>
              {/* Active members */}
              <Card>
                <CardHeader icon={Users} title="Team Members" />
                {membersLoading ? (
                  <div className="flex justify-center py-10"><LogoSpinner size={16} /></div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {activeMembers.map(m => {
                      const label   = m.display_name || m.invited_email.split('@')[0];
                      const isMe    = m.user_id === user?.id;
                      const canEdit = isOwner && m.role !== 'owner';
                      return (
                        <div key={m.id} className="px-4 sm:px-6 py-4 flex items-start gap-3 hover:bg-gray-50/50 transition-colors">
                          <div className={`w-9 h-9 rounded-xl ${getAvatarColor(label)} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                            {label[0]?.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900 truncate">{label}</span>
                              {isMe && <span className="account-settings-label text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-md font-semibold">You</span>}
                            </div>
                            <span className="text-[11px] text-gray-400 truncate block">{m.invited_email}</span>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0 max-w-[45%] sm:max-w-none">
                            <AccessBadge access={m.role === 'admin' ? 'full' : m.data_access} locked={m.role !== 'member'} />
                            <RoleBadge role={m.role} />
                            {canEdit && (
                              <>
                                <button onClick={() => openEdit(m)}
                                  className="p-1.5 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                                  <Pencil size={13} />
                                </button>
                                <button onClick={() => handleRemove(m)} disabled={removingId === m.id}
                                  className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Remove">
                                  {removingId === m.id ? <LogoSpinner size={13} /> : <Trash2 size={13} />}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {activeMembers.length === 0 && (
                      <div className="px-6 py-8 text-center text-sm text-gray-400">No active members yet.</div>
                    )}
                  </div>
                )}
              </Card>

              {/* Pending invites */}
              {pendingMembers.length > 0 && (
                <Card>
                  <CardHeader icon={Mail} title="Pending Invites"
                    action={<span className="account-settings-label text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full font-medium">{pendingMembers.length}</span>} />
                  <div className="divide-y divide-gray-50">
                    {pendingMembers.map(m => (
                      <div key={m.id} className="px-4 sm:px-6 py-3.5 flex items-start gap-3">
                        <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                          <Mail size={13} className="text-amber-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {m.display_name && <span className="text-sm font-semibold text-gray-800 truncate block">{m.display_name}</span>}
                          <span className="text-sm text-gray-500 truncate block">{m.invited_email}</span>
                          <span className="text-[10px] text-gray-400">Invited · hasn't signed up yet</span>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0 max-w-[45%] sm:max-w-none">
                          <AccessBadge access={m.data_access} />
                          <RoleBadge role={m.role} />
                          <button onClick={() => copyInviteLink(m)}
                            className="p-1.5 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Copy invite">
                            {copiedId === m.id ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                          </button>
                          {isOwner && (
                            <>
                              <button onClick={() => openEdit(m)}
                                className="p-1.5 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors">
                                <Pencil size={13} />
                              </button>
                              <button onClick={() => handleRemove(m)} disabled={removingId === m.id}
                                className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                {removingId === m.id ? <LogoSpinner size={13} /> : <Trash2 size={13} />}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Invite form — owner only */}
              {isOwner && (
                <Card>
                  <CardHeader icon={Plus} title="Invite Team Member"
                    description="Invite a teammate by email. They sign up at /signup with that email to join." />
                  <div className="px-4 sm:px-6 py-5">
                    <form onSubmit={handleInvite} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1.5">Full Name</label>
                          <div className="relative">
                            <UserCheck size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input type="text" value={inviteName} onChange={e => setInviteName(e.target.value)}
                              placeholder="Jane Smith"
                              className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors" />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1.5">Email Address <span className="text-red-400">*</span></label>
                          <div className="relative">
                            <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                              placeholder="colleague@agency.com" required
                              className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors" />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1.5">Role</label>
                          <select value={inviteRole}
                            onChange={e => { const r = e.target.value as 'admin' | 'member'; setInviteRole(r); if (r === 'admin') setInviteAccess('full'); }}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400">
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1.5">Data Access</label>
                          <select value={inviteRole === 'admin' ? 'full' : inviteAccess}
                            onChange={e => setInviteAccess(e.target.value as 'full' | 'assigned_only')}
                            disabled={inviteRole === 'admin'}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-400">
                            <option value="full">Full Access</option>
                            <option value="assigned_only">Assigned / Created Only</option>
                          </select>
                          {inviteRole === 'admin'
                            ? <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1"><Lock size={9} />Admins always have full access</p>
                            : inviteAccess === 'assigned_only'
                            ? <p className="text-[10px] text-orange-500 mt-1">Member sees only profiles &amp; data assigned to them</p>
                            : null}
                        </div>
                      </div>

                      <div className="flex justify-end pt-1">
                        <button type="submit" disabled={inviting || !inviteEmail.trim()}
                          className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors">
                          {inviting ? <LogoSpinner size={13} /> : <Plus size={13} />}Add Member
                        </button>
                      </div>
                    </form>
                  </div>
                </Card>
              )}

            </>
          )}

          {/* ── BILLING ── */}
          {section === 'billing' && (
            <>
              {!isOwner && (
                <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
                  <Info size={13} className="shrink-0" />
                  Billing is managed by the workspace owner. Contact them for changes.
                </div>
              )}

              <Card>
                <CardHeader icon={CreditCard} title="Current Plan" />
                <div className="px-4 sm:px-6 py-5">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5 pb-5 border-b border-gray-100">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`account-settings-label text-xs font-semibold px-2.5 py-1 rounded-lg border ${planStyle}`}>{planLabel}</span>
                        {subscription?.cancel_at_period_end && (
                          <span className="account-settings-label text-xs text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded-lg">Cancels at period end</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {subscription?.current_period_end
                          ? `Renews ${new Date(subscription.current_period_end).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}`
                          : account?.is_trial ? 'Free trial — upgrade to unlock all features' : 'No active subscription'}
                      </p>
                    </div>
                    {isOwner && (
                      <button onClick={() => navigate('/billing')}
                        className="self-start flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors">
                        Manage Billing <ArrowRight size={12} />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 xs:grid-cols-2 gap-3 sm:gap-4">
                    {shouldShowCreditsUi() && (
                      <div className="bg-gray-50 rounded-xl p-4">
                        <p className="text-[10px] text-gray-400 mb-1">AI Credits Balance</p>
                        <p className="text-2xl font-black text-gray-900">${Number(account?.credits_balance ?? 0).toFixed(2)}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Available for AI features</p>
                      </div>
                    )}
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="text-[10px] text-gray-400 mb-1">Team Size</p>
                      <p className="text-2xl font-black text-gray-900">{activeMembers.length}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Active members</p>
                    </div>
                  </div>
                </div>
              </Card>

            </>
          )}

        </div>
      </div>

      {/* ── Edit Member Modal ── */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditingMember(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto">
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Edit Member</h2>
                <p className="text-xs text-gray-400 mt-0.5">{editingMember.invited_email}</p>
              </div>
              <button onClick={() => setEditingMember(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="px-4 sm:px-6 py-5 space-y-4">
              {/* Avatar + name preview */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className={`w-9 h-9 rounded-xl ${getAvatarColor(editName || editingMember.invited_email)} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                  {(editName || editingMember.invited_email)[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{editName || editingMember.invited_email.split('@')[0]}</p>
                  <p className="text-[11px] text-gray-400 truncate">{editingMember.invited_email}</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Display Name</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                  placeholder="Full name (optional)" autoFocus
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Role</label>
                  <select value={editRole}
                    onChange={e => { const r = e.target.value as 'admin' | 'member'; setEditRole(r); if (r === 'admin') setEditAccess('full'); }}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400">
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Data Access</label>
                  <select value={editRole === 'admin' ? 'full' : editAccess}
                    onChange={e => setEditAccess(e.target.value as 'full' | 'assigned_only')}
                    disabled={editRole === 'admin'}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-400">
                    <option value="full">Full Access</option>
                    <option value="assigned_only">Assigned Only</option>
                  </select>
                  {editRole === 'admin'
                    ? <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1"><Lock size={9} />Admins have full access</p>
                    : editAccess === 'assigned_only'
                    ? <p className="text-[10px] text-orange-500 mt-1">Sees only assigned candidates</p>
                    : null}
                </div>
              </div>

              {/* Preview badges */}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[10px] text-gray-400">Preview:</span>
                <RoleBadge role={editRole} />
                <AccessBadge access={editRole === 'admin' ? 'full' : editAccess} locked={editRole !== 'member'} />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 px-4 sm:px-6 py-4 border-t border-gray-100">
              <button onClick={() => setEditingMember(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
                <Save size={13} />{savingEdit ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Workspace Modal ── */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { setDeleteModal(false); setDeleteConfirm(''); }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto">
            <div className="px-4 sm:px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
                  <AlertTriangle size={18} className="text-red-600" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Delete Workspace</h2>
                  <p className="text-xs text-red-500">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-sm text-gray-600">
                This will permanently delete <strong>{account?.name}</strong> including all candidates, jobs, team members, and data. There is no recovery.
              </p>
            </div>
            <div className="px-4 sm:px-6 py-5">
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Type <span className="font-bold text-gray-900">{account?.name}</span> to confirm:
              </label>
              <input type="text" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
                placeholder={account?.name}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 transition-colors" />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2.5 px-4 sm:px-6 py-4 border-t border-gray-100">
              <button onClick={() => { setDeleteModal(false); setDeleteConfirm(''); }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button
                disabled={deleteConfirm !== account?.name || deletingWs}
                onClick={() => showToast('Please contact support to delete your workspace.', 'error')}
                className="flex items-center gap-1.5 px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors">
                {deletingWs ? <LogoSpinner size={13} /> : <Trash2 size={13} />}Delete Workspace
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
