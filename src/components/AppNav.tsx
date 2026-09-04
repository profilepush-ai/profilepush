import { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown, HelpCircle, LogOut, Settings,
  Building2, Map, CreditCard, AlertTriangle, FileText,
  Bell, BellRing, Check, X,
  Activity, Briefcase, MoonStar, SunMedium, Mail, Megaphone, Database, Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Logo from './Logo';
import { supabase } from '../lib/supabase';
import type { AppNotification } from '../lib/notifications';
import { shouldShowCreditsUi } from '../lib/feature-gates';

// Shows the account's real Google profile photo (from user_metadata, set by
// Supabase's Google OAuth flow) when available, falling back to the same
// initials circle used for email/password accounts that have no photo — and
// for a Google photo URL that 404s/fails to load.
function UserAvatar({ pictureUrl, initials, sizeClass }: { pictureUrl: string | null; initials: string; sizeClass: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (pictureUrl && !imageFailed) {
    return (
      <img
        src={pictureUrl}
        alt=""
        referrerPolicy="no-referrer"
        className={`${sizeClass} shrink-0 rounded-full object-cover`}
        onError={() => setImageFailed(true)}
      />
    );
  }
  return (
    <div className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-blue-600 font-bold text-white`}>
      {initials}
    </div>
  );
}

const navItems = [
  { path: '/feed',          label: 'Feed',           mobileLabel: 'Feed',    icon: Briefcase, hideOnMobile: false },
  { path: '/posts',        label: 'Posts',          mobileLabel: 'Posts',   icon: Megaphone, hideOnMobile: false },
  { path: '/inbox',        label: 'Inbox',          mobileLabel: 'Inbox',   icon: Mail,      hideOnMobile: false },
  { path: '/tracker',       label: 'Tracker',        mobileLabel: 'Tracker', icon: FileText,  hideOnMobile: false },
  { path: '/contacts',      label: 'Contacts',       mobileLabel: 'Contacts', icon: Users,    hideOnMobile: false },
  { path: '/pulse',        label: 'Pulse',          mobileLabel: 'Pulse',   icon: Activity,  hideOnMobile: false },
  { path: '/active-list',   label: 'List',           mobileLabel: 'List', icon: Database,  hideOnMobile: false },
];

function CreditsChip({ balance }: { balance: number }) {
  const { isDark } = useTheme();
  const isLow = balance < 1;
  const isZero = balance <= 0;

  const creditsLabel = Math.floor(Math.max(0, balance)).toLocaleString('en-IN');

  if (isZero) {
    return (
      <Link
        to="/billing"
        className={`flex items-center gap-1 px-2 py-0.5 rounded-full border border-current text-red-600 text-[11px] font-bold transition-colors ${isDark ? 'bg-transparent hover:bg-transparent' : 'bg-[rgb(254,242,242)] hover:bg-[rgb(254,226,226)]'}`}
        title="No credits remaining — top up"
      >
        <AlertTriangle size={9} />
        0 credits
      </Link>
    );
  }

  if (isLow) {
    return (
      <Link
        to="/billing"
        className={`flex items-center gap-1 px-2 py-0.5 rounded-full border border-current text-amber-700 text-[11px] font-bold transition-colors ${isDark ? 'bg-transparent hover:bg-transparent' : 'bg-[rgb(255,251,235)] hover:bg-[rgb(254,243,199)]'}`}
        title="Low credits"
      >
        <AlertTriangle size={9} />
        {`${creditsLabel} credit${creditsLabel === '1' ? '' : 's'}`}
      </Link>
    );
  }

  return (
    <Link
      to="/billing"
      className={`flex items-center gap-1 px-2 py-0.5 rounded-full border border-current text-emerald-700 text-[11px] font-bold transition-colors ${isDark ? 'bg-transparent hover:bg-transparent' : 'bg-[rgb(236,253,245)] hover:bg-[rgb(209,250,229)]'}`}
      title="Credits remaining"
    >
      <CreditCard size={9} />
      {`${creditsLabel} credits`}
    </Link>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function NotificationBell({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadNotifications();
    // Realtime subscription for new notifications
    const channel = supabase
      .channel('notifications-bell')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => {
        loadNotifications();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function loadNotifications() {
    const { data } = await supabase
      .from('notifications')
      .select('id, type, title, body, link, read, created_at')
      .order('created_at', { ascending: false })
      .limit(15);
    if (data) {
      setNotifications(data as AppNotification[]);
      setUnreadCount(data.filter(n => !n.read).length);
    }
  }

  async function markRead(id: string) {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  }

  async function markAllRead() {
    const ids = notifications.filter(n => !n.read).map(n => n.id);
    if (!ids.length) return;
    await supabase.from('notifications').update({ read: true }).in('id', ids);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  }

  function handleNotifClick(n: AppNotification) {
    if (!n.read) markRead(n.id);
    if (n.link) navigate(n.link);
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
        title="Notifications"
      >
        {unreadCount > 0 ? <BellRing size={15} className="text-blue-600" /> : <Bell size={15} />}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-2 top-10 z-50 mt-1.5 flex max-h-[calc(100dvh-7rem)] w-auto flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#20242A] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:max-h-[calc(100dvh-4rem)] sm:w-80">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-white/10">
            <div className="flex items-center gap-2">
              <Bell size={13} className="text-gray-500 dark:text-slate-400" />
              <span className="text-[13px] font-semibold text-gray-900 dark:text-slate-100">Notifications</span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">{unreadCount} new</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-[11px] text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1">
                  <Check size={10} />Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200">
                <X size={13} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto overscroll-contain dark:divide-white/10">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <Bell size={22} className="mb-2 opacity-40" />
                <p className="text-[13px] font-medium">No notifications yet</p>
                <p className="text-[12px] mt-0.5 opacity-70">You're all caught up</p>
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => handleNotifClick(n)}
                  className={`w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/5 ${!n.read ? 'bg-blue-50/40 dark:bg-blue-500/[0.07]' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-[12px] leading-snug ${!n.read ? 'font-semibold text-gray-900 dark:text-slate-100' : 'font-medium text-gray-700 dark:text-slate-300'}`}>
                        {n.title}
                      </p>
                      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-1" />}
                    </div>
                    {n.body && <p className="mt-0.5 truncate text-[11px] text-gray-400 dark:text-slate-400">{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-gray-400 dark:text-slate-500">{timeAgo(n.created_at)}</p>
                  </div>
                </button>
              ))
            )}
          </div>

        </div>
      )}
    </div>
  );
}

export default function AppNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const { user, account, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [inboxUnread, setInboxUnread] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!user) return;
    const loadUnread = async () => {
      const [{ data }, { data: chatData }] = await Promise.all([
        supabase.from('vendor_conversations').select('unread_count'),
        account?.id
          ? supabase
            .from('post_chat_threads' as never)
            .select('owner_account_id, owner_unread_count, participant_account_id, participant_unread_count')
            .or(`owner_account_id.eq.${account.id},participant_account_id.eq.${account.id}`)
          : Promise.resolve({ data: [] }),
      ]);
      const emailUnread = (data ?? []).reduce((sum, row) => sum + Number(row.unread_count || 0), 0);
      const chatRows = (chatData ?? []) as unknown as Array<{ owner_account_id: string; owner_unread_count: number; participant_account_id: string; participant_unread_count: number }>;
      const chatUnread = chatRows.reduce((sum, row) => sum + (row.owner_account_id === account?.id ? Number(row.owner_unread_count || 0) : Number(row.participant_unread_count || 0)), 0);
      setInboxUnread(emailUnread + chatUnread);
    };
    void loadUnread();
    const channel = supabase
      .channel('inbox-nav-unread')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_conversations' }, () => { void loadUnread(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_chat_threads' }, () => { void loadUnread(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user, account?.id]);

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  const initials = user?.user_metadata?.full_name
    ? (user.user_metadata.full_name as string).split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : user?.email?.[0]?.toUpperCase() ?? '?';
  // Supabase's Google provider maps the OIDC `picture` claim to both keys
  // depending on flow (signInWithIdToken vs signInWithOAuth) — check both.
  const pictureUrl = (user?.user_metadata?.avatar_url as string | undefined)
    || (user?.user_metadata?.picture as string | undefined)
    || null;

  return (
    <>
    <header className="min-h-12 bg-white flex items-center px-3 sm:px-4 gap-3 sm:gap-6 shrink-0 z-50 pt-[env(safe-area-inset-top)]">
      {user ? (
        <span className="flex items-center shrink-0">
          <Logo size="sm" />
        </span>
      ) : (
        <Link to="/" className="flex items-center shrink-0">
          <Logo size="sm" />
        </Link>
      )}

      {/* Mobile: credits chip + account avatar */}
      {user && (
        <span className="sm:hidden ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50"
          >
            {isDark ? <SunMedium size={14} /> : <MoonStar size={14} />}
          </button>
          {shouldShowCreditsUi() && account != null && <CreditsChip balance={account.credits_balance} />}
          <NotificationBell userId={user.id} />
          <Link to="/account" className="shrink-0" title="Account">
            <UserAvatar pictureUrl={pictureUrl} initials={initials} sizeClass="h-8 w-8 text-[13px]" />
          </Link>
        </span>
      )}

      <nav className="hidden sm:flex items-center gap-1 flex-1">
        {navItems.map(({ path, label, mobileLabel, icon: Icon, hideOnMobile }) => {
          const active = location.pathname === path || location.pathname.startsWith(path + '/');
          return (
            <Link
              key={path}
              to={path}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-[13px] font-medium transition-colors ${hideOnMobile ? 'hidden sm:flex' : ''} ${
                active ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <Icon size={12} />
              <span className="hidden sm:inline">{label}</span>
              {path === '/inbox' && inboxUnread > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">{inboxUnread > 99 ? '99+' : inboxUnread}</span>}
              {!hideOnMobile && <span className="sm:hidden">{mobileLabel}</span>}
            </Link>
          );
        })}

        {/* Credits chip shown inline on mobile */}
        {shouldShowCreditsUi() && user && account != null && (
          <span className="sm:hidden flex items-center">
            <CreditsChip balance={account.credits_balance} />
          </span>
        )}

        <span className="hidden sm:block w-px h-4 bg-gray-200 mx-1" />

        <Link
          to="/support"
          className={`hidden sm:inline-flex h-7 w-7 items-center justify-center rounded transition-colors ${
            location.pathname === '/support' ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
          }`}
          aria-label="Help"
          title="Help"
        >
          <HelpCircle size={14} />
        </Link>

        <Link
          to="/roadmap"
          className={`hidden sm:flex items-center gap-1.5 px-3 py-1 rounded text-[13px] font-medium transition-colors ${
            location.pathname === '/roadmap' ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
          }`}
          title="Roadmap"
        >
          <Map size={12} />
        </Link>
      </nav>

      {/* Credits + Bell + Profile */}
      {user && (
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="hidden sm:inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50"
          >
            {isDark ? <SunMedium size={13} /> : <MoonStar size={13} />}
          </button>

          {shouldShowCreditsUi() && account != null && (
            <span className="hidden sm:block">
              <CreditsChip balance={account.credits_balance} />
            </span>
          )}

          {/* Notification bell */}
          <span className="hidden sm:block">
            <NotificationBell userId={user.id} />
          </span>

          {/* Profile avatar menu */}
          <div className="hidden sm:block relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="flex items-center gap-1 pl-1 pr-1 py-1 rounded-lg hover:bg-gray-100 transition-colors group"
              title={(user.user_metadata?.full_name as string | undefined) || user.email || 'Account'}
            >
              <UserAvatar pictureUrl={pictureUrl} initials={initials} sizeClass="w-6 h-6 text-[11px]" />
              <ChevronDown size={11} className="text-gray-400 group-hover:text-gray-600 transition-colors" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-56 bg-white rounded-xl shadow-lg border border-gray-200 py-1.5 z-50">
                <div className="px-3 py-2.5 border-b border-gray-100 mb-1">
                  <p className="text-[13px] font-semibold text-gray-800 truncate">
                    {user.user_metadata?.full_name as string || user.email}
                  </p>
                  <p className="text-[11px] text-gray-400 truncate mt-0.5">{user.email}</p>
                  {account && (
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-1">
                        <Building2 size={10} className="text-gray-400 shrink-0" />
                        <span className="text-[11px] text-gray-500 truncate">{account.name}</span>
                      </div>
                      {shouldShowCreditsUi() && <CreditsChip balance={account.credits_balance} />}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => { setMenuOpen(false); navigate('/account'); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                >
                  <Settings size={13} className="text-gray-400" />
                  Account Settings
                </button>

                <button
                  onClick={() => { setMenuOpen(false); navigate('/billing'); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                >
                  <CreditCard size={13} className="text-gray-400" />
                  Billing & Credits
                </button>

                <div className="border-t border-gray-100 mt-1 pt-1">
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-red-500 hover:bg-red-50 transition-colors rounded-b-xl"
                  >
                    <LogOut size={13} />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </header>

      {/* Mobile Bottom Navigation */}
      {user && (
        <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden">
          <Link
            to="/feed"
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-[13px] font-medium ${location.pathname === '/feed' ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <Briefcase size={24} />
            <span>Feed</span>
          </Link>
          <Link
            to="/posts"
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-[13px] font-medium ${location.pathname.startsWith('/posts') ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <Megaphone size={24} />
            <span>Posts</span>
          </Link>
          <Link
            to="/inbox"
            className={`relative flex flex-1 flex-col items-center gap-1 py-2 text-[13px] font-medium ${location.pathname.startsWith('/inbox') ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <Mail size={24} />
            <span>Inbox</span>
            {inboxUnread > 0 && <span className="absolute right-[24%] top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{inboxUnread > 9 ? '9+' : inboxUnread}</span>}
          </Link>
          <Link
            to="/pulse"
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-[13px] font-medium ${location.pathname === '/pulse' ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <Activity size={24} />
            <span>Pulse</span>
          </Link>
        </nav>
      )}
    </>
  );
}
