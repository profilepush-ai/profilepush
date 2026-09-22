import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Notification = {
  id: string;
  kind: string;
  label: string;
  request_type: string;
  status: 'new' | 'seen' | 'done' | 'declined';
  note: string | null;
  created_at: string;
  account_name: string;
  is_trial: boolean | null;
  user_email: string;
};

async function callAdminNotifications(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('admin-notifications', {
    body: { password: sessionStorage.getItem('admin_authed') || '', ...body },
  });
  if (error || data?.error) throw new Error(error?.message || data.error);
  return data;
}

const STATUS_STYLES: Record<Notification['status'], string> = {
  new: 'bg-blue-100 text-blue-700',
  seen: 'bg-gray-100 text-gray-600',
  done: 'bg-green-100 text-green-700',
  declined: 'bg-red-50 text-red-600',
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function AdminNotificationsPanel() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [demand, setDemand] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await callAdminNotifications({ action: 'list' });
      setNotifications((data.notifications as Notification[]) ?? []);
      setDemand((data.demand as Record<string, number>) ?? {});
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setStatus(id: string, status: Notification['status']) {
    setBusy(id);
    // Optimistic: the list is the work queue, and waiting on a round trip to
    // see a row change state makes triage feel broken.
    setNotifications((current) => current.map((n) => (n.id === id ? { ...n, status } : n)));
    try {
      await callAdminNotifications({ action: 'set_status', id, status });
    } catch (err) {
      setError((err as Error).message);
      await load();
    } finally {
      setBusy(null);
    }
  }

  const unread = notifications.filter((n) => n.status === 'new').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {Object.entries(demand).map(([type, count]) => (
          <div key={type} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase text-gray-500">
              {type === 'outlook_send' ? 'Outlook send requests' : type}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{count}</p>
            <p className="mt-0.5 text-[10px] text-gray-400">accounts asking</p>
          </div>
        ))}
        <button
          onClick={() => void load()}
          className="ml-auto flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
          <Bell size={14} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Requests</h2>
          {unread > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              {unread} new
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-8 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-400">
            Nothing yet. Feature requests from inside the app land here.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {notifications.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{item.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[item.status]}`}>
                      {item.status}
                    </span>
                    {item.is_trial === false && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        paid
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {item.account_name} · {item.user_email} · {formatWhen(item.created_at)}
                  </p>
                  {item.note && <p className="mt-1 text-xs text-gray-700">{item.note}</p>}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {item.status !== 'done' && (
                    <button
                      onClick={() => void setStatus(item.id, 'done')}
                      disabled={busy === item.id}
                      title="Mark as built or handled"
                      className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:border-green-500 hover:text-green-700 disabled:opacity-40"
                    >
                      <Check size={12} /> Done
                    </button>
                  )}
                  {item.status === 'new' && (
                    <button
                      onClick={() => void setStatus(item.id, 'seen')}
                      disabled={busy === item.id}
                      className="rounded-md border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:border-gray-400 disabled:opacity-40"
                    >
                      Seen
                    </button>
                  )}
                  {item.status !== 'declined' && (
                    <button
                      onClick={() => void setStatus(item.id, 'declined')}
                      disabled={busy === item.id}
                      title="Not building this"
                      className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-500 hover:border-red-400 hover:text-red-600 disabled:opacity-40"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
