import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building2, Users, User, Shield, CreditCard, AlertTriangle,
  Copy, Check, Plus, Trash2, Pencil, X, Save, Mail,
  Crown, Eye, EyeOff, Lock, LogOut,
  ArrowRight, ChevronDown, ChevronRight, RefreshCw, Info, Zap,
  UserCheck,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import LogoSpinner from '../components/LogoSpinner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Member {
  id: string; account_id: string; user_id: string | null;
  invited_email: string; display_name: string | null;
  role: 'owner' | 'admin' | 'member'; status: 'active' | 'invited';
  data_access: 'full' | 'assigned_only';
}

type Section = 'profile' | 'workspace' | 'team' | 'watch_schedule' | 'billing' | 'danger';

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

const PERMISSION_MATRIX = [
  { feature: 'View all candidates',      owner: true,  admin: true,  full: true,  assigned: 'own' },
  { feature: 'Edit & manage candidates', owner: true,  admin: true,  full: true,  assigned: 'own' },
  { feature: 'Source & apply to jobs',   owner: true,  admin: true,  full: true,  assigned: 'own' },
  { feature: 'Run AI features',          owner: true,  admin: true,  full: true,  assigned: true  },
  { feature: 'Manage tracker',           owner: true,  admin: true,  full: true,  assigned: 'own' },
  { feature: 'View team members',        owner: true,  admin: true,  full: true,  assigned: true  },
  { feature: 'Invite & manage team',     owner: true,  admin: false, full: false, assigned: false },
  { feature: 'Access billing & plan',    owner: true,  admin: false, full: false, assigned: false },
];

const NAV_ITEMS: { id: Section; label: string; icon: React.ElementType; danger?: boolean }[] = [
  { id: 'profile',       label: 'My Profile',        icon: User      },
  { id: 'workspace',     label: 'Workspace',          icon: Building2 },
  { id: 'team',          label: 'Team Members',       icon: Users     },
  { id: 'billing',       label: 'Plan & Billing',     icon: CreditCard },
  { id: 'danger',        label: 'Danger Zone',        icon: AlertTriangle, danger: true },
];

// ─── Small reusable pieces ─────────────────────────────────────────────────────

function RoleBadge({ role }: { role: 'owner' | 'admin' | 'member' }) {
  const meta = ROLE_META[role];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border ${meta.cls}`}>
      <Icon size={8} />{meta.label}
    </span>
  );
}

function AccessBadge({ access, locked }: { access: 'full' | 'assigned_only'; locked?: boolean }) {
  if (access === 'full') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
      {locked ? <Lock size={8} /> : <Eye size={8} />}Full Access
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200">
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
    <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
      {Icon && <Icon size={15} className="text-gray-400 shrink-0" />}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function PermCell({ val }: { val: boolean | 'own' }) {  if (val === true)  return <span className="text-emerald-500 font-bold text-sm">✓</span>;
  if (val === 'own') return <span className="text-amber-500 font-bold text-xs">Own</span>;
  return <span className="text-gray-300 text-sm">—</span>;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AccountSettings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, account, membership, subscription, refreshAccount, signOut } = useAuth();

  const isOwner = membership?.role === 'owner';
  const isPaidPlan = subscription?.status === 'active' && (subscription.plan_amount_usd ?? 0) > 0;

  // ── Global ──────────────────────────────────────────────────
  const [section, setSection] = useState<Section>(() => {
    const s = searchParams.get('section');
    return NAV_ITEMS.some((item) => item.id === s) ? s as Section : 'profile';
  });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => setToast({ message, type });

  // ── Watch Schedule ──────────────────────────────────────────
  const [globalWatch, setGlobalWatch] = useState<WatchSchedule | null>(null);
  const [savingWatch, setSavingWatch] = useState(false);

  // ── Members ──────────────────────────────────────────────────
  const [members, setMembers]       = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [copiedId, setCopiedId]     = useState<string | null>(null);
  const [showMatrix, setShowMatrix] = useState(false);

  // ── Profile ──────────────────────────────────────────────────
  const [profileName, setProfileName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // ── Workspace ────────────────────────────────────────────────
  const [accountName, setAccountName] = useState('');
  const [savingName, setSavingName]   = useState(false);
  const [copiedAccountId, setCopiedAccountId] = useState(false);

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
    if (membership) setProfileName(membership.display_name ?? '');
    if (account)    setAccountName(account.name);
    if (account)    loadMembers();
    if (account)    loadWatchSchedule();
  }, [account, membership]);

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

  // ── Profile handlers ──────────────────────────────────────────
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!membership) return;
    setSavingProfile(true);
    const { error } = await supabase.from('account_members')
      .update({ display_name: profileName.trim() || null })
      .eq('id', membership.id);
    if (error) showToast('Failed to update profile', 'error');
    else { await refreshAccount(); showToast('Profile updated'); }
    setSavingProfile(false);
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

  function copyAccountId() {
    navigator.clipboard.writeText(account?.id ?? '');
    setCopiedAccountId(true);
    setTimeout(() => setCopiedAccountId(false), 2000);
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
    if (subscription.status === 'active') return `$${subscription.plan_amount_usd}/mo`;
    return subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1);
  })();
  const planStyle = subscription?.status === 'active'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-gray-50 flex flex-col overscroll-none pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />

      <div className="flex-1 max-w-5xl mx-auto w-full px-3 sm:px-4 py-4 sm:py-8 flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">

        {/* ── Sidebar ── */}
        <aside className="w-full sm:w-52 shrink-0 sm:sticky sm:top-8">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-2">
            {/* User summary */}
            <div className="hidden sm:flex items-center gap-2.5 px-3 py-3 mb-1 border-b border-gray-100">
              <div className={`w-8 h-8 rounded-full ${getAvatarColor(displayName)} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                {initial}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-900 truncate">{displayName}</p>
                <p className="text-[10px] text-gray-400 truncate">{user?.email}</p>
              </div>
            </div>

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

          {/* Account info pill */}
          {account && (
            <div className="hidden sm:block mt-3 px-3 py-2.5 bg-white rounded-xl border border-gray-200 text-[10px] text-gray-400 space-y-1">
              <div className="flex justify-between"><span>Plan</span><span className={`font-semibold px-1.5 py-0.5 rounded text-[9px] border ${planStyle}`}>{planLabel}</span></div>
              <div className="flex justify-between"><span>Members</span><span className="font-semibold text-gray-600">{activeMembers.length}</span></div>
              <div className="flex justify-between"><span>Your role</span><span className="font-semibold text-gray-600 capitalize">{membership?.role ?? '—'}</span></div>
            </div>
          )}
        </aside>

        {/* ── Content ── */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* ── PROFILE ── */}
          {section === 'profile' && (
            <>
              <Card>
                <CardHeader icon={User} title="Personal Information" />
                <div className="px-6 py-5">
                  {/* Avatar */}
                  <div className="flex items-center gap-4 mb-6 pb-5 border-b border-gray-100">
                    <div className={`w-14 h-14 rounded-2xl ${getAvatarColor(displayName)} flex items-center justify-center text-white text-2xl font-black`}>
                      {initial}
                    </div>
                    <div>
                      <p className="text-base font-bold text-gray-900">{displayName}</p>
                      <p className="text-xs text-gray-400">{user?.email}</p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {membership && <RoleBadge role={membership.role} />}
                        {membership && <AccessBadge access={membership.role === 'admin' ? 'full' : membership.data_access} locked={membership.role !== 'member'} />}
                      </div>
                    </div>
                  </div>

                  <form onSubmit={saveProfile} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1.5">Display Name</label>
                        <input type="text" value={profileName} onChange={e => setProfileName(e.target.value)}
                          placeholder="Your name"
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors" />
                        <p className="text-[10px] text-gray-400 mt-1">Shown to teammates instead of email</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1.5">Email Address</label>
                        <input type="email" value={user?.email ?? ''} disabled
                          className="w-full border border-gray-100 rounded-lg px-3 py-2 text-sm text-gray-500 bg-gray-50 cursor-not-allowed" />
                        <p className="text-[10px] text-gray-400 mt-1">Managed by your auth provider</p>
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button type="submit" disabled={savingProfile}
                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
                        {savingProfile ? <LogoSpinner size={13} /> : <Save size={13} />}Save Profile
                      </button>
                    </div>
                  </form>
                </div>
              </Card>

              {/* Logout */}
              <button
                onClick={() => void signOut()}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut size={15} />
                Logout
              </button>
            </>
          )}

          {/* ── WORKSPACE ── */}
          {section === 'workspace' && (
            <>
              <Card>
                <CardHeader icon={Building2} title="Workspace Details" />
                <div className="px-6 py-5 space-y-5">
                  <form onSubmit={saveAccountName}>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Workspace Name</label>
                    <div className="flex gap-2">
                      <input type="text" value={accountName} onChange={e => setAccountName(e.target.value)}
                        disabled={!isOwner}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 disabled:bg-gray-50 disabled:text-gray-500 transition-colors" />
                      {isOwner && (
                        <button type="submit" disabled={savingName || accountName === account?.name}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-1.5">
                          {savingName ? <LogoSpinner size={13} /> : <Save size={13} />}Save
                        </button>
                      )}
                    </div>
                    {!isOwner && <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1"><Info size={9} />Only the owner can change the workspace name</p>}
                  </form>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Account ID</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-500 font-mono truncate">
                        {account?.id ?? '—'}
                      </code>
                      <button onClick={copyAccountId}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Copy account ID">
                        {copiedAccountId ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">Reference this ID when contacting support</p>
                  </div>
                </div>
              </Card>

              <Card>
                <CardHeader icon={Users} title="Workspace Overview" />
                <div className="px-6 py-4">
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: 'Active Members', value: activeMembers.length },
                      { label: 'Pending Invites', value: pendingMembers.length },
                      { label: 'Current Plan', value: planLabel },
                    ].map((item, i) => (
                      <div key={i} className="bg-gray-50 rounded-xl p-4 text-center">
                        <p className="text-xl font-black text-gray-900">{item.value}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">{item.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </>
          )}

          {/* ── TEAM ── */}
          {section === 'team' && (
            <>
              {/* Active members */}
              <Card>
                <CardHeader icon={Users} title="Active Members"
                  action={<span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">{activeMembers.length}</span>} />
                {membersLoading ? (
                  <div className="flex justify-center py-10"><LogoSpinner size={16} /></div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {activeMembers.map(m => {
                      const label   = m.display_name || m.invited_email.split('@')[0];
                      const isMe    = m.user_id === user?.id;
                      const canEdit = isOwner && m.role !== 'owner';
                      return (
                        <div key={m.id} className="px-6 py-4 flex items-center gap-3 hover:bg-gray-50/50 transition-colors">
                          <div className={`w-9 h-9 rounded-xl ${getAvatarColor(label)} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                            {label[0]?.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900 truncate">{label}</span>
                              {isMe && <span className="text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-md font-semibold">You</span>}
                            </div>
                            <span className="text-[11px] text-gray-400 truncate block">{m.invited_email}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
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
                    action={<span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full font-medium">{pendingMembers.length}</span>} />
                  <div className="divide-y divide-gray-50">
                    {pendingMembers.map(m => (
                      <div key={m.id} className="px-6 py-3.5 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                          <Mail size={13} className="text-amber-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {m.display_name && <span className="text-sm font-semibold text-gray-800 truncate block">{m.display_name}</span>}
                          <span className="text-sm text-gray-500 truncate block">{m.invited_email}</span>
                          <span className="text-[10px] text-gray-400">Invited · hasn't signed up yet</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
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
                  <div className="px-6 py-5">
                    <form onSubmit={handleInvite} className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
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

                      <div className="grid grid-cols-2 gap-3">
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

              {/* Permission matrix */}
              <Card>
                <button onClick={() => setShowMatrix(v => !v)}
                  className="w-full px-6 py-4 flex items-center gap-3 text-left hover:bg-gray-50/50 transition-colors">
                  <Shield size={15} className="text-gray-400 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">Permission Matrix</p>
                    <p className="text-xs text-gray-400 mt-0.5">What each role can access and do</p>
                  </div>
                  {showMatrix ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                </button>
                {showMatrix && (
                  <div className="px-6 pb-5 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-2 text-gray-500 font-medium w-52">Feature</th>
                          {[
                            { label: 'Owner', cls: 'text-amber-600' },
                            { label: 'Admin', cls: 'text-blue-600' },
                            { label: 'Member (Full)', cls: 'text-gray-600' },
                            { label: 'Member (Assigned)', cls: 'text-orange-600' },
                          ].map(h => (
                            <th key={h.label} className={`text-center py-2 px-3 font-semibold ${h.cls}`}>{h.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {PERMISSION_MATRIX.map((row, i) => (
                          <tr key={i} className="border-b border-gray-50 last:border-0">
                            <td className="py-2.5 text-gray-700 text-[11px]">{row.feature}</td>
                            <td className="text-center py-2.5"><PermCell val={row.owner as boolean | 'own'} /></td>
                            <td className="text-center py-2.5"><PermCell val={row.admin as boolean | 'own'} /></td>
                            <td className="text-center py-2.5"><PermCell val={row.full as boolean | 'own'} /></td>
                            <td className="text-center py-2.5"><PermCell val={row.assigned as boolean | 'own'} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 text-[10px] text-gray-400">
                      <span className="flex items-center gap-1"><span className="text-emerald-500 font-bold text-sm">✓</span> Full access</span>
                      <span className="flex items-center gap-1"><span className="text-amber-500 font-bold text-xs">Own</span> Own records only</span>
                      <span className="flex items-center gap-1"><span className="text-gray-300 text-sm">—</span> No access</span>
                    </div>
                  </div>
                )}
              </Card>
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
                <div className="px-6 py-5">
                  <div className="flex items-start justify-between mb-5 pb-5 border-b border-gray-100">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${planStyle}`}>{planLabel}</span>
                        {subscription?.cancel_at_period_end && (
                          <span className="text-xs text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded-lg">Cancels at period end</span>
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
                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors">
                        Manage Billing <ArrowRight size={12} />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="text-[10px] text-gray-400 mb-1">AI Credits Balance</p>
                      <p className="text-2xl font-black text-gray-900">${Number(account?.credits_balance ?? 0).toFixed(2)}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Available for AI features</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4">
                      <p className="text-[10px] text-gray-400 mb-1">Team Size</p>
                      <p className="text-2xl font-black text-gray-900">{activeMembers.length}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">Active members</p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <CardHeader icon={Zap} title="What's Included" />
                <div className="px-6 py-4">
                  {[
                    'AI resume parsing & rewriting',
                    'Job board search (LinkedIn, Dice, Indeed, Monster, CareerBuilder)',
                    'AI job match scoring',
                    'Team collaboration & member management',
                    'Candidate pipeline tracking',
                    'Submission & communications tracking',
                  ].map((feat, i) => (
                    <div key={i} className="flex items-center gap-2.5 py-2 border-b border-gray-50 last:border-0">
                      <Check size={13} className="text-emerald-500 shrink-0" />
                      <span className="text-xs text-gray-700">{feat}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}

          {/* ── DANGER ZONE ── */}
          {section === 'danger' && (
            <>
              {/* Leave workspace — non-owners */}
              {!isOwner && (
                <Card>
                  <div className="px-6 py-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Leave Workspace</p>
                        <p className="text-xs text-gray-500 mt-1">
                          You will lose access to <span className="font-medium">{account?.name}</span> immediately.
                          You can rejoin only if the owner invites you again.
                        </p>
                      </div>
                      {!confirmLeave ? (
                        <button onClick={() => setConfirmLeave(true)}
                          className="shrink-0 flex items-center gap-1.5 px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold rounded-lg transition-colors">
                          <LogOut size={13} />Leave
                        </button>
                      ) : (
                        <div className="shrink-0 flex items-center gap-2">
                          <span className="text-xs text-gray-500">Are you sure?</span>
                          <button onClick={() => setConfirmLeave(false)}
                            className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
                          <button onClick={leaveWorkspace} disabled={leavingWs}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors">
                            {leavingWs ? <LogoSpinner size={12} /> : null}Leave workspace
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              )}

              {/* Delete workspace — owner only */}
              {isOwner && (
                <Card>
                  <div className="px-6 py-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Delete Workspace</p>
                        <p className="text-xs text-gray-500 mt-1">
                          Permanently delete <span className="font-medium">{account?.name}</span> and all associated data.
                          This action is <span className="font-semibold text-red-600">irreversible</span> — all candidates,
                          jobs, team members, and settings will be lost.
                        </p>
                      </div>
                      <button onClick={() => setDeleteModal(true)}
                        className="shrink-0 flex items-center gap-1.5 px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold rounded-lg transition-colors">
                        <Trash2 size={13} />Delete
                      </button>
                    </div>
                  </div>
                </Card>
              )}

              {/* Transfer ownership hint */}
              {isOwner && activeMembers.length > 1 && (
                <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700">
                  <Info size={13} className="shrink-0 mt-0.5" />
                  <span>To transfer ownership, edit a team member and set their role to <strong>Owner</strong>. Contact support if you need assistance.</span>
                </div>
              )}
            </>
          )}

        </div>
      </div>

      {/* ── Edit Member Modal ── */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditingMember(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Edit Member</h2>
                <p className="text-xs text-gray-400 mt-0.5">{editingMember.invited_email}</p>
              </div>
              <button onClick={() => setEditingMember(null)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Avatar + name preview */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <div className={`w-9 h-9 rounded-xl ${getAvatarColor(editName || editingMember.invited_email)} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                  {(editName || editingMember.invited_email)[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{editName || editingMember.invited_email.split('@')[0]}</p>
                  <p className="text-[11px] text-gray-400">{editingMember.invited_email}</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Display Name</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                  placeholder="Full name (optional)" autoFocus
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-colors" />
              </div>

              <div className="grid grid-cols-2 gap-3">
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

            <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-gray-100">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { setDeleteModal(false); setDeleteConfirm(''); }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-5 border-b border-gray-100">
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
            <div className="px-6 py-5">
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Type <span className="font-bold text-gray-900">{account?.name}</span> to confirm:
              </label>
              <input type="text" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
                placeholder={account?.name}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 transition-colors" />
            </div>
            <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-gray-100">
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
