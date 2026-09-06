import { useEffect, useRef, useState } from 'react';
import { Download, Hash, Loader2, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Channel = { id: string; slug: string; name: string; created_at: string };
type ScreenshotItem = { route: string; label: string; viewport: string; url: string };
type Message = {
  id: string;
  kind: 'text' | 'screenshot_batch';
  body: string | null;
  metadata: { items?: ScreenshotItem[]; skipped?: string[] };
  author_label: string;
  created_at: string;
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

async function callAdminChannels(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('admin-channels', {
    body: { password: sessionStorage.getItem('admin_authed') || '', ...body },
  });
  if (error || data?.error) throw new Error(error?.message || data.error);
  return data;
}

export default function AdminChannelsPanel() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const data = await callAdminChannels({ action: 'list_channels' });
        const rows = (data.channels ?? []) as Channel[];
        setChannels(rows);
        if (rows.length > 0) setSelectedSlug(rows[0].slug);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    void (async () => {
      setMessagesLoading(true);
      setError('');
      try {
        const data = await callAdminChannels({ action: 'list_messages', channel_slug: selectedSlug, limit: 100 });
        setMessages((data.messages ?? []) as Message[]);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setMessagesLoading(false);
      }
    })();
  }, [selectedSlug]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || !selectedSlug) return;
    setSending(true);
    try {
      const data = await callAdminChannels({ action: 'post_message', channel_slug: selectedSlug, body });
      setMessages((prev) => [...prev, data.message as Message]);
      setDraft('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="flex h-[calc(100vh-56px)] min-h-0">
      <aside className="w-48 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 p-2">
        <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">Channels</p>
        {channels.map((channel) => (
          <button
            key={channel.id}
            type="button"
            onClick={() => setSelectedSlug(channel.slug)}
            className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] font-semibold transition ${selectedSlug === channel.slug ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <Hash size={12} className={selectedSlug === channel.slug ? 'text-white' : 'text-gray-400'} />
            {channel.name}
          </button>
        ))}
        {channels.length === 0 && (
          <p className="px-2 text-[11px] text-gray-400">No channels yet.</p>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-[12px] text-red-600">{error}</div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {messagesLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 size={18} className="animate-spin text-gray-400" /></div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center">
              <p className="text-[12px] text-gray-400">No messages in this channel yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div key={message.id} className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-[12px] font-bold text-gray-900">{message.author_label}</span>
                    <span className="text-[10px] text-gray-400">{formatTimestamp(message.created_at)}</span>
                  </div>

                  {message.kind === 'text' ? (
                    <p className="whitespace-pre-wrap break-words text-[13px] text-gray-700">{message.body}</p>
                  ) : (
                    <div>
                      <p className="mb-2 text-[13px] font-semibold text-gray-800">{message.body}</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {(message.metadata.items ?? []).map((item) => (
                          <a
                            key={`${item.route}-${item.viewport}`}
                            href={item.url}
                            download
                            className="group relative overflow-hidden rounded-md border border-gray-200 bg-gray-50"
                          >
                            <img src={item.url} alt={`${item.label} (${item.viewport})`} className="h-28 w-full object-cover object-top" loading="lazy" />
                            <div className="flex items-center justify-between gap-1 border-t border-gray-200 bg-white px-1.5 py-1">
                              <span className="min-w-0 truncate text-[10px] font-medium text-gray-600">{item.label} · {item.viewport}</span>
                              <Download size={11} className="shrink-0 text-gray-400 group-hover:text-blue-600" />
                            </div>
                          </a>
                        ))}
                      </div>
                      {(message.metadata.skipped ?? []).length > 0 && (
                        <p className="mt-2 text-[10px] text-gray-400">
                          Skipped: {(message.metadata.skipped ?? []).join(', ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-gray-200 p-3">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !sending) void handleSend(); }}
            placeholder={selectedSlug ? `Message #${channels.find((c) => c.slug === selectedSlug)?.name ?? selectedSlug}` : 'Select a channel'}
            disabled={!selectedSlug}
            className="flex-1 rounded-md border border-gray-200 px-3 py-2 text-[13px] text-gray-700 outline-none focus:border-blue-400 disabled:bg-gray-50"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!draft.trim() || sending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
