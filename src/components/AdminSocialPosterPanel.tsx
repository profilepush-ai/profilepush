import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Send, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type ChannelResult = { ok: boolean; id?: string; error?: string };

// Whatever is connected in Buffer. Not a fixed list, so connecting another
// account there makes it postable here without a deploy.
type BufferChannel = {
  id: string;
  service?: string;
  name?: string;
  displayName?: string;
  isLocked?: boolean;
};

type SocialPost = {
  id: string;
  body: string;
  link_url: string | null;
  image_url: string | null;
  channels: string[];
  channel_labels: Record<string, string>;
  status: 'draft' | 'publishing' | 'posted' | 'partial' | 'failed';
  results: Record<string, ChannelResult>;
  created_at: string;
  posted_at: string | null;
};

// LinkedIn is the strictest of the networks Buffer fans out to, so one
// counter against its limit covers the rest.
const LINKEDIN_LIMIT = 3000;

async function callAdminSocial(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('admin-social-post', {
    body: { password: sessionStorage.getItem('admin_authed') || '', ...body },
  });
  if (error || data?.error) throw new Error(error?.message || data.error);
  return data;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function channelLabel(channel: BufferChannel): string {
  const service = (channel.service ?? '').replace(/^\w/, (c) => c.toUpperCase());
  const handle = channel.displayName || channel.name || '';
  return [service, handle].filter(Boolean).join(' · ') || channel.id;
}

const STATUS_STYLES: Record<SocialPost['status'], string> = {
  draft: 'bg-gray-100 text-gray-600',
  publishing: 'bg-blue-100 text-blue-700',
  posted: 'bg-green-100 text-green-700',
  partial: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-700',
};

export default function AdminSocialPosterPanel() {
  const [body, setBody] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [channels, setChannels] = useState<BufferChannel[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [channelError, setChannelError] = useState('');
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [channelData, listData] = await Promise.all([
        callAdminSocial({ action: 'channels' }),
        callAdminSocial({ action: 'list' }),
      ]);
      const list = (channelData.channels as BufferChannel[]) ?? [];
      setChannels(list);
      setChannelError((channelData.error as string) ?? '');
      // Everything connected is ticked by default — the point of the panel is
      // posting to all of them; unticking is the exception.
      setSelected((current) => (current.length
        ? current.filter((id) => list.some((c) => c.id === id && !c.isLocked))
        : list.filter((c) => !c.isLocked).map((c) => c.id)));
      setPosts((listData.posts as SocialPost[]) ?? []);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function publish() {
    if (!body.trim() || !selected.length || publishing) return;
    setPublishing(true);
    setError('');
    setNotice('');
    try {
      const labels = Object.fromEntries(
        channels.filter((c) => selected.includes(c.id)).map((c) => [c.id, channelLabel(c)]),
      );
      const result = await callAdminSocial({
        action: 'publish',
        body,
        link_url: linkUrl.trim() || null,
        image_url: imageUrl.trim() || null,
        channels: selected,
        channel_labels: labels,
      });
      const status = result.status as SocialPost['status'];
      if (status === 'posted') {
        setBody('');
        setLinkUrl('');
        setImageUrl('');
        setNotice('Published to every selected channel.');
      } else if (status === 'partial') {
        setNotice('Published to some channels. The rest are listed below with the reason — use Retry.');
      } else {
        setError('Nothing published. See the reason below.');
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  async function retry(id: string) {
    setRetrying(id);
    setError('');
    try {
      await callAdminSocial({ action: 'retry', id });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetrying(null);
    }
  }

  async function remove(id: string) {
    try {
      await callAdminSocial({ action: 'delete', id });
      setPosts((current) => current.filter((p) => p.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Instagram (and TikTok, if it is ever connected) reject a post with no
  // media. Selected by default with nothing attached, every publish would
  // fail on that channel alone and come back as a partial.
  const needsImage = channels.filter(
    (c) => selected.includes(c.id) && ['instagram', 'tiktok', 'pinterest', 'youtube'].includes((c.service ?? '').toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Compose</h2>
          <button
            onClick={() => void load()}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {!loading && (channelError || channels.length === 0) && (
          <div className="mb-3 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">No channels available.</p>
              <p className="mt-0.5">
                {channelError || 'Buffer returned no connected channels.'} Connect the Facebook page and
                LinkedIn account at <span className="font-medium">buffer.com</span>, then set{' '}
                <code>BUFFER_API_KEY</code> as a secret on the{' '}
                <code>admin-social-post</code> function and refresh.
              </p>
            </div>
          </div>
        )}

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          maxLength={LINKEDIN_LIMIT}
          placeholder="What do you want to post?"
          className="w-full resize-y rounded-md border border-gray-300 p-3 text-sm focus:border-blue-500 focus:outline-none"
        />
        <div className="mt-1 flex justify-end">
          <span className={`text-xs ${body.length > LINKEDIN_LIMIT - 200 ? 'text-amber-600' : 'text-gray-400'}`}>
            {body.length} / {LINKEDIN_LIMIT}
          </span>
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="Link (optional) — appended to the post"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="Image URL (optional)"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {channels.map((channel) => {
            const active = selected.includes(channel.id);
            return (
              <button
                key={channel.id}
                disabled={channel.isLocked}
                title={channel.isLocked ? 'Locked in Buffer — over the plan\'s channel limit' : ''}
                onClick={() => setSelected((current) =>
                  current.includes(channel.id) ? current.filter((c) => c !== channel.id) : [...current, channel.id])}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  channel.isLocked
                    ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300'
                    : active
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-300 text-gray-600 hover:border-gray-400'
                }`}
              >
                {channelLabel(channel)}
              </button>
            );
          })}

          <button
            onClick={() => void publish()}
            disabled={publishing || !body.trim() || !selected.length}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {publishing ? 'Publishing…' : `Publish to ${selected.length || 'no'} channel${selected.length === 1 ? '' : 's'}`}
          </button>
        </div>

        {needsImage.length > 0 && !imageUrl.trim() && (
          <p className="mt-2 text-xs text-amber-700">
            {needsImage.map((c) => channelLabel(c)).join(' and ')} cannot publish a text-only post — add an image
            URL or untick {needsImage.length === 1 ? 'it' : 'them'}.
          </p>
        )}
        {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
        {notice && <p className="mt-2 text-xs font-medium text-green-700">{notice}</p>}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">History</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center p-8 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-400">Nothing posted yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {posts.map((post) => {
              const failed = post.channels.filter((c) => !post.results?.[c]?.ok);
              const labelFor = (id: string) =>
                post.channel_labels?.[id] ?? channels.find((c) => c.id === id)?.service ?? id.slice(0, 8);
              return (
                <li key={post.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-gray-800">{post.body}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[post.status]}`}>
                      {post.status}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                    <span className="text-gray-400">{formatTimestamp(post.created_at)}</span>
                    {post.channels.map((channelId) => {
                      const result = post.results?.[channelId];
                      return (
                        <span
                          key={channelId}
                          className={`flex items-center gap-1 ${result?.ok ? 'text-green-700' : 'text-red-600'}`}
                          title={result?.error ?? ''}
                        >
                          {result?.ok
                            ? <CheckCircle2 className="h-3 w-3" />
                            : <AlertCircle className="h-3 w-3" />}
                          {labelFor(channelId)}
                          {!result?.ok && ` — ${result?.error ? result.error.slice(0, 80) : 'not attempted'}`}
                        </span>
                      );
                    })}
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    {failed.length > 0 && (
                      <button
                        onClick={() => void retry(post.id)}
                        disabled={retrying === post.id}
                        className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:text-gray-300"
                      >
                        {retrying === post.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <RefreshCw className="h-3 w-3" />}
                        Retry {failed.map(labelFor).join(' + ')}
                      </button>
                    )}
                    <button
                      onClick={() => void remove(post.id)}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-600"
                      title="Removes this row only — anything already published stays on the network"
                    >
                      <Trash2 className="h-3 w-3" /> Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
