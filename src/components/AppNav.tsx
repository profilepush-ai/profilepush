import { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Users, Bookmark, ChevronDown, LogOut, Settings,
  Building2, LifeBuoy, Map, CreditCard, AlertTriangle, PenLine, FileText,
  Bell, BellRing, Check, ArrowRight, X,
  Activity, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Logo from './Logo';
import { supabase } from '../lib/supabase';
import type { AppNotification, NotificationType } from '../lib/notifications';
import { NOTIFICATION_TYPES } from '../lib/notifications';

const navItems = [
  { path: '/pulse',          label: 'Pulse',          mobileLabel: 'Pulse',   icon: Activity,  hideOnMobile: false },
  { path: '/watchlist-profiles', label: 'Watchlist', mobileLabel: 'Watch',   icon: Bookmark, hideOnMobile: false },
  { path: '/tracker',       label: 'Tracker',        mobileLabel: 'Tracker', icon: FileText,  hideOnMobile: false },
  { path: '/resume-ai',     label: 'Resume AI',      mobileLabel: 'AI',      icon: PenLine,   hideOnMobile: true },
];

function CreditsChip({ balance }: { balance: number }) {
  const isLow = balance < 1;
  const isZero = balance <= 0;

  if (isZero) {
    return (
      <Link
        to="/billing"
        className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600 text-[10px] font-bold hover:bg-red-100 transition-colors"
        title="No credits remaining — top up"
      >
        <AlertTriangle size={9} />
        $0.00
      </Link>
    );
  }

  if (isLow) {
    return (
      <Link
        to="/billing"
        className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold hover:bg-amber-100 transition-colors"
        title="Low credits"
      >
        <AlertTriangle size={9} />
        {`$${balance.toFixed(2)}`}
      </Link>
    );
  }

  return (
    <Link
      to="/billing"
      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold hover:bg-emerald-100 transition-colors"
      title="Credits remaining"
    >
      <CreditCard size={9} />
      {`$${balance.toFixed(2)}`}
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

const TYPE_COLORS: Record<string, string> = {
  Pipeline: 'bg-blue-100 text-blue-600',
  AI:       'bg-orange-100 text-orange-600',
  Usage:    'bg-amber-100 text-amber-600',
  Team:     'bg-emerald-100 text-emerald-600',
  Billing:  'bg-violet-100 text-violet-600',
  Reports:  'bg-gray-100 text-gray-600',
};

function NotificationBell({ userId, accountId }: { userId: string; accountId: string | null }) {
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

  const groupColor = (type: string) => {
    const group = NOTIFICATION_TYPES[type as NotificationType]?.group ?? 'Reports';
    return TYPE_COLORS[group] ?? TYPE_COLORS.Reports;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
        title="Notifications"
      >
        {unreadCount > 0 ? <BellRing size={15} className="text-blue-600" /> : <Bell size={15} />}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Bell size={13} className="text-gray-500" />
              <span className="text-xs font-semibold text-gray-900">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded-full">{unreadCount} new</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-[10px] text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1">
                  <Check size={10} />Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-0.5 rounded text-gray-400 hover:text-gray-600">
                <X size={13} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <Bell size={22} className="mb-2 opacity-40" />
                <p className="text-xs font-medium">No notifications yet</p>
                <p className="text-[11px] mt-0.5 opacity-70">You're all caught up</p>
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => handleNotifClick(n)}
                  className={`w-full text-left flex gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${!n.read ? 'bg-blue-50/40' : ''}`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${groupColor(n.type)}`}>
                    {(NOTIFICATION_TYPES[n.type as NotificationType]?.label?.[0] ?? '?')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-[11px] leading-snug ${!n.read ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                        {n.title}
                      </p>
                      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-1" />}
                    </div>
                    {n.body && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{n.body}</p>}
                    <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(n.created_at)}</p>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 px-4 py-2.5">
            <button
              onClick={() => { setOpen(false); navigate('/account?section=notifications'); }}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] text-blue-600 hover:text-blue-700 font-semibold"
            >
              Notification preferences <ArrowRight size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, account, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
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

  async function handleSignOut() {
    await signOut();
    navigate('/');
  }

  const initials = user?.user_metadata?.full_name
    ? (user.user_metadata.full_name as string).split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <>
    <header className="h-10 bg-white border-b border-gray-200 flex items-center px-2 sm:px-4 gap-2 sm:gap-6 shrink-0 z-50">
      {user ? (
        <span className="flex items-center shrink-0">
          <Logo size="sm" />
        </span>
      ) : (
        <Link to="/" className="flex items-center shrink-0">
          <Logo size="sm" />
        </Link>
      )}

      {/* Mobile: credits chip next to logo */}
      {user && account != null && (
        <span className="sm:hidden ml-auto">
          <CreditsChip balance={account.credits_balance} />
        </span>
      )}

      <nav className="hidden sm:flex items-center gap-1 flex-1">
        {navItems.map(({ path, label, mobileLabel, icon: Icon, hideOnMobile }) => {
          const active = location.pathname === path || location.pathname.startsWith(path + '/');
          return (
            <Link
              key={path}
              to={path}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${hideOnMobile ? 'hidden sm:flex' : ''} ${
                active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <Icon size={12} />
              <span className="hidden sm:inline">{label}</span>
              {!hideOnMobile && <span className="sm:hidden">{mobileLabel}</span>}
            </Link>
          );
        })}

        {/* Credits chip shown inline on mobile */}
        {user && account != null && (
          <span className="sm:hidden flex items-center">
            <CreditsChip balance={account.credits_balance} />
          </span>
        )}

        <span className="hidden sm:block w-px h-4 bg-gray-200 mx-1" />

        <Link
          to="/support"
          className={`hidden sm:flex items-center px-3 py-1 rounded text-xs font-medium transition-colors ${
            location.pathname === '/support' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          ? Help
        </Link>

        <Link
          to="/roadmap"
          className={`hidden sm:flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
            location.pathname === '/roadmap' ? 'bg-amber-50 text-amber-700' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
          }`}
          title="Roadmap"
        >
          <Map size={12} />
        </Link>
      </nav>

      {/* Credits + Bell + Profile */}
      {user && (
        <div className="flex items-center gap-2 shrink-0">
          {account != null && (
            <span className="hidden sm:block">
              <CreditsChip balance={account.credits_balance} />
            </span>
          )}

          {/* Notification bell */}
          <span className="hidden sm:block">
            <NotificationBell userId={user.id} accountId={account?.id ?? null} />
          </span>

          {/* Profile avatar menu */}
          <div className="hidden sm:block relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="flex items-center gap-1 pl-1 pr-1 py-1 rounded-lg hover:bg-gray-100 transition-colors group"
              title={(user.user_metadata?.full_name as string | undefined) || user.email || 'Account'}
            >
              <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                {initials}
              </div>
              <ChevronDown size={11} className="text-gray-400 group-hover:text-gray-600 transition-colors" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-56 bg-white rounded-xl shadow-lg border border-gray-200 py-1.5 z-50">
                <div className="px-3 py-2.5 border-b border-gray-100 mb-1">
                  <p className="text-xs font-semibold text-gray-800 truncate">
                    {user.user_metadata?.full_name as string || user.email}
                  </p>
                  <p className="text-[10px] text-gray-400 truncate mt-0.5">{user.email}</p>
                  {account && (
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-1">
                        <Building2 size={10} className="text-gray-400 shrink-0" />
                        <span className="text-[10px] text-gray-500 truncate">{account.name}</span>
                      </div>
                      <CreditsChip balance={account.credits_balance} />
                    </div>
                  )}
                </div>

                <button
                  onClick={() => { setMenuOpen(false); navigate('/account'); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                >
                  <Settings size={13} className="text-gray-400" />
                  Account Settings
                </button>

                <button
                  onClick={() => { setMenuOpen(false); navigate('/billing'); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                >
                  <CreditCard size={13} className="text-gray-400" />
                  Billing & Credits
                </button>

                <div className="border-t border-gray-100 mt-1 pt-1">
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors rounded-b-xl"
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
            to="/pulse"
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${location.pathname === '/pulse' ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <Activity size={18} />
            <span>Pulse</span>
          </Link>
          <Link
            to="/tracker"
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${location.pathname === '/tracker' ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <ShieldCheck size={18} />
            <span>Tracker</span>
          </Link>
          <Link
            to="/watchlist-profiles"
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${location.pathname === '/watchlist-profiles' ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <Bookmark size={18} />
            <span>My Watchlist</span>
          </Link>
          <Link
            to="/alerts"
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${location.pathname === '/alerts' ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <Bell size={18} />
            <span>Alerts</span>
          </Link>
          <Link
            to="/account"
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${location.pathname === '/account' ? 'text-blue-600' : 'text-gray-500'}`}
          >
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[8px] font-bold text-white">
              {initials}
            </div>
            <span>Profile</span>
          </Link>
        </nav>
      )}
    </>
  );
}
