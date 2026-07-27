import { useState, useEffect, useCallback, useRef } from 'react';
import { Send, Paperclip, ImageIcon, X, CheckCircle2, LifeBuoy, Clock, ChevronDown } from 'lucide-react';
import AppNav from '../components/AppNav';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import LogoSpinner from '../components/LogoSpinner';

interface Ticket {
  id: string;
  subject: string;
  description: string;
  screenshot_url: string | null;
  status: 'open' | 'in_progress' | 'resolved';
  created_at: string;
}

const STATUS_STYLES: Record<Ticket['status'], string> = {
  open:        'bg-blue-50 text-blue-700 border-blue-100',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-100',
  resolved:    'bg-green-50 text-green-700 border-green-100',
};

const STATUS_LABELS: Record<Ticket['status'], string> = {
  open:        'Open',
  in_progress: 'In Progress',
  resolved:    'Resolved',
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86_400_000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export default function SupportPage() {
  const { user, account } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const loadTickets = useCallback(async () => {
    if (!user) return;
    setTicketsLoading(true);
    const { data } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setTickets(data ?? []);
    setTicketsLoading(false);
  }, [user]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > 5 * 1024 * 1024) {
      setFormError('Screenshot must be under 5 MB.');
      return;
    }
    setFile(f);
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) {
      setFormError('Subject and message are required.');
      return;
    }
    setSubmitting(true);
    setFormError(null);

    let screenshotUrl: string | null = null;
    if (file && user) {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('support-screenshots')
        .upload(path, file, { upsert: false });
      if (uploadErr) {
        setFormError('Screenshot upload failed. Please try again.');
        setSubmitting(false);
        return;
      }
      const { data: urlData } = supabase.storage.from('support-screenshots').getPublicUrl(path);
      screenshotUrl = urlData?.publicUrl ?? null;
    }

    const { error: insertErr } = await supabase.from('support_tickets').insert({
      user_id: user!.id,
      account_id: account?.id ?? null,
      subject: subject.trim(),
      description: description.trim(),
      screenshot_url: screenshotUrl,
    });

    if (insertErr) {
      setFormError('Failed to submit ticket. Please try again.');
      setSubmitting(false);
      return;
    }

    // Fire-and-forget webhook — non-blocking, never fails the UI
    try {
      await fetch('https://services.leadconnectorhq.com/hooks/48XyGfN1WxneooOcHGHn/webhook-trigger/85e0c5e5-75eb-40c5-bc77-acef14dbf486', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket: {
            subject: subject.trim(),
            description: description.trim(),
            screenshot_url: screenshotUrl,
          },
          user: {
            id: user!.id,
            email: user!.email,
            full_name: user!.user_metadata?.full_name ?? null,
          },
          account: account ? {
            id: account.id,
            name: account.name,
            owner_id: account.owner_id,
            credits_balance: account.credits_balance,
          } : null,
        }),
      });
    } catch { /* non-fatal */ }

    setSubmitted(true);
    setSubmitting(false);
    setTimeout(() => {
      setSubmitted(false);
      setSubject('');
      setDescription('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      loadTickets();
    }, 2200);
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <AppNav />

      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* Page header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-white shrink-0">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <LifeBuoy size={15} className="text-blue-500" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900">Support</h1>
              <p className="text-[11px] text-gray-400 mt-0.5">Submit a ticket and track your requests</p>
            </div>
          </div>
        </div>

        {/* Two-column body */}
        <div className="flex-1 overflow-hidden">
          <div className="max-w-7xl mx-auto h-full flex gap-5 px-6 py-5">

            {/* Left: ticket history */}
            <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col overflow-hidden min-w-0">
              <div className="px-5 py-3.5 border-b border-gray-100 shrink-0 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-700">Your Tickets</span>
                {!ticketsLoading && (
                  <span className="text-[10px] text-gray-400">{tickets.length} total</span>
                )}
              </div>

              {ticketsLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <LogoSpinner size={18} />
                </div>
              ) : tickets.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
                  <div className="w-11 h-11 rounded-2xl bg-blue-50 flex items-center justify-center">
                    <LifeBuoy size={18} className="text-blue-300" />
                  </div>
                  <p className="text-sm font-semibold text-gray-700">No tickets yet</p>
                  <p className="text-xs text-gray-400">Use the form to reach out to our team.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
                  {tickets.map(ticket => (
                    <div key={ticket.id} className="group">
                      <button
                        onClick={() => setExpandedId(expandedId === ticket.id ? null : ticket.id)}
                        className="w-full text-left px-5 py-3.5 flex items-start gap-3 hover:bg-gray-50/70 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLES[ticket.status]}`}>
                              {STATUS_LABELS[ticket.status]}
                            </span>
                            <span className="text-xs font-semibold text-gray-800 truncate">{ticket.subject}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <Clock size={10} className="text-gray-400 shrink-0" />
                            <span className="text-[10px] text-gray-400">{timeAgo(ticket.created_at)}</span>
                          </div>
                        </div>
                        <ChevronDown
                          size={13}
                          className={`text-gray-400 shrink-0 mt-0.5 transition-transform ${expandedId === ticket.id ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {expandedId === ticket.id && (
                        <div className="px-5 pb-4 bg-gray-50/50">
                          <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{ticket.description}</p>
                          {ticket.screenshot_url && (
                            <a
                              href={ticket.screenshot_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 mt-2.5 text-[11px] text-blue-600 hover:text-blue-800 font-medium"
                            >
                              <ImageIcon size={11} /> View screenshot
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: submit form */}
            <div className="w-80 shrink-0 flex flex-col gap-4">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h2 className="text-sm font-bold text-gray-900">New Ticket</h2>
                  <p className="text-[11px] text-gray-400 mt-0.5">We typically reply within 24 hours</p>
                </div>

                {submitted ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-5">
                    <div className="w-11 h-11 rounded-full bg-green-50 flex items-center justify-center">
                      <CheckCircle2 size={20} className="text-green-500" />
                    </div>
                    <p className="text-sm font-bold text-gray-900">Ticket submitted!</p>
                    <p className="text-xs text-gray-500">
                      We'll reply to <span className="font-medium text-gray-700">{user?.email}</span>.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
                    {formError && (
                      <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2.5 rounded-lg">
                        {formError}
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                        Subject <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        placeholder="Briefly describe the issue"
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 placeholder:text-gray-300 transition-all"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                        Message <span className="text-red-400">*</span>
                      </label>
                      <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder="Describe what happened and steps to reproduce…"
                        rows={5}
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 placeholder:text-gray-300 transition-all resize-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
                        Screenshot <span className="text-gray-400 font-normal normal-case">(optional, max 5 MB)</span>
                      </label>
                      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
                      {file ? (
                        <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
                          <ImageIcon size={13} className="text-blue-500 shrink-0" />
                          <span className="text-xs text-blue-700 font-medium truncate flex-1">{file.name}</span>
                          <button type="button"
                            onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                            className="p-0.5 rounded hover:bg-blue-100 transition-colors">
                            <X size={11} className="text-blue-500" />
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => fileRef.current?.click()}
                          className="w-full flex items-center gap-2 px-3 py-2.5 border border-dashed border-gray-300 rounded-xl text-xs text-gray-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/50 transition-all">
                          <Paperclip size={13} /> Attach a screenshot
                        </button>
                      )}
                    </div>

                    <button type="submit" disabled={submitting}
                      className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold py-2.5 rounded-xl transition-colors">
                      {submitting ? <LogoSpinner size={13} /> : <Send size={13} />}
                      {submitting ? 'Submitting…' : 'Submit Ticket'}
                    </button>
                  </form>
                )}
              </div>

              {/* Info */}
              <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4">
                <p className="text-xs font-semibold text-blue-800 mb-1">What happens next?</p>
                <p className="text-[11px] text-blue-700 leading-relaxed">
                  Our team reviews every ticket and responds via email within 24 hours. For urgent issues, include as much detail and context as possible.
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
