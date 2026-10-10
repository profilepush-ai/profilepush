import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { useAiSubmit } from '../AiSubmit';
import { loadLeadsByIds, recordLeadShare } from '../LeadCard';
import { supabase } from '../../lib/supabase';
import { trackEvent } from '../../lib/track';
import { dismissCard, leadOrg, restoreCard, setSaved, shareLink, type CardItem, type Kind, type Question, type Subject } from '../../lib/today';
import type { Draft } from './MatchDetail';

const UNDO_MS = 5000;

async function invokeSubmit(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('submit-consultant', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const payload = ctx ? await ctx.json().catch(() => null) : null;
    return { ok: false as const, code: payload?.error as string | undefined, message: (payload?.message || payload?.error || error.message) as string };
  }
  return { ok: true as const, data };
}

export type Toast = { msg: string; undo?: () => void; tone?: 'error' };

// Apply, Ask Resume, Save, Pass and Share for a match, the same on Today and
// History. `take` removes the card from the page and returns how to put it back.
export function useMatchActions({ kind, accountId, userId, subjects, take, onChanged, onOpen }: {
  kind: Kind; accountId: string | undefined; userId: string | undefined; subjects: Record<string, Subject>;
  take: (item: CardItem) => () => void; onChanged: () => void; onOpen: (item: CardItem) => void;
}) {
  const navigate = useNavigate();
  const [toast, setToast] = useState<Toast | null>(null);
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [appliedNow, setAppliedNow] = useState(0);
  // Career sites that let their page show inside ours (checked ahead, so the
  // tap opens it straight away), and the one open now.
  const [frameOk, setFrameOk] = useState<Record<string, boolean>>({});
  const [frame, setFrame] = useState<{ item: CardItem; url: string } | null>(null);
  const checking = useRef(new Set<string>());
  const checkFrame = useCallback((item: CardItem | null | undefined) => {
    if (!item?.lead || item.lead.source !== 'career_site' || Capacitor.isNativePlatform()) return;
    const id = item.lead_id;
    if (checking.current.has(id)) return;
    checking.current.add(id);
    void supabase.functions.invoke('submit-consultant', { body: { action: 'frame_check', job_id: id } })
      .then(({ data }) => setFrameOk((m) => ({ ...m, [id]: Boolean(data?.embeddable) })));
  }, []);

  // Questions this account already asked posters, by post.
  const [asked, setAsked] = useState<Record<string, Question[]>>({});
  useEffect(() => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    void supabase.from('post_questions' as never).select('lead_id, question').gte('created_at', since).limit(2000)
      .then(({ data }: { data: Array<{ lead_id: string; question: Question }> | null }) => {
        const map: Record<string, Question[]> = {};
        for (const r of data ?? []) (map[r.lead_id] ??= []).push(r.question);
        setAsked(map);
      });
  }, []);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, { timer: ReturnType<typeof setTimeout>; run: () => Promise<void> }>>({});

  const showToast = useCallback((msg: string, undo?: () => void, tone?: 'error') => {
    setToast({ msg, undo, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), undo ? UNDO_MS : 3500);
  }, []);

  useEffect(() => {
    if (kind !== 'hotlist') return;
    void supabase.from('gmail_integration_status' as never).select('status').maybeSingle()
      .then(({ data }: { data: { status?: string } | null }) => setGmailConnected(data?.status === 'connected'));
  }, [kind]);

  // Sends still in their undo window go out now if the page is left.
  useEffect(() => () => {
    Object.values(pending.current).forEach((p) => { clearTimeout(p.timer); void p.run(); });
    pending.current = {};
  }, []);

  const connectGmail = async () => {
    if (!accountId) return;
    const { data, error } = await supabase.functions.invoke('gmail-oauth-start', { body: { account_id: accountId, return_to: window.location.pathname, return_origin: window.location.origin } });
    if (error || !data?.url) { showToast('Could not start the Gmail connection.', undefined, 'error'); return; }
    window.location.href = data.url;
  };

  // Email: out of the list now, sent after a few seconds unless undone.
  const applyEmail = (item: CardItem, draft: Draft | null, resumeId: string | null) => {
    if (!accountId || !item.lead) return;
    if (gmailConnected === false) { onOpen(item); return; }
    const restore = take(item);
    const cardId = item.card_id;
    const to = draft?.toName || item.lead.poster || leadOrg(item.lead);
    const run = async () => {
      delete pending.current[cardId];
      setBusy(cardId);
      const fallbackResume = subjects[item.subject_id]?.resumes?.find((r) => r.is_default)?.id;
      const resume = resumeId || fallbackResume;
      const r = await invokeSubmit({
        action: 'send', account_id: accountId, subject_id: item.subject_id, job_id: item.lead_id, request_id: crypto.randomUUID(),
        ...(resume ? { resume_id: resume } : {}),
        ...(draft ? { subject: draft.subject, body: draft.body } : {}),
      });
      setBusy(null);
      if (!r.ok) {
        restore();
        if (r.code === 'gmail_not_connected') setGmailConnected(false);
        showToast(r.code === 'daily_limit_reached' ? 'Daily apply limit reached. Paid plans apply up to 100 a day.' : r.message || 'Could not apply.', undefined, 'error');
        return;
      }
      setAppliedNow((n) => n + 1);
      trackEvent('today_applied', { how: 'email' });
      onChanged();
    };
    const timer = setTimeout(() => { void run(); }, UNDO_MS);
    pending.current[cardId] = { timer, run };
    showToast(`Applying to ${to} by email`, () => { clearTimeout(timer); delete pending.current[cardId]; restore(); });
  };

  // Career site: open their page (inside the click, so it isn't blocked) and
  // count it as applied. Undo puts it back.
  const applySite = (item: CardItem) => {
    if (!item.lead) return;
    const url = item.lead.apply_url || item.lead.post_url;
    // Inside ProfilePush where we can: the app's in-app browser, or on the web
    // our own window for sites that allow it; otherwise a new tab.
    if (url && Capacitor.isNativePlatform()) void Browser.open({ url, presentationStyle: 'popover' });
    else if (url && frameOk[item.lead_id]) setFrame({ item, url });
    else if (url) window.open(url, '_blank', 'noopener');
    const restore = take(item);
    setAppliedNow((n) => n + 1);
    void supabase.rpc('mark_external_applied' as never, { p_job_id: item.lead_id, p_subject_id: item.subject_id } as never).then(() => onChanged());
    trackEvent('today_applied', { how: 'site' });
    showToast(`Opened ${leadOrg(item.lead)}'s site. Marked applied.`, () => {
      restore();
      setAppliedNow((n) => Math.max(0, n - 1));
      void supabase.rpc('undo_site_apply' as never, { p_card_id: item.card_id } as never).then(() => onChanged());
    });
  };

  // Vendors: the resume request is written by AI and reviewed in a dialog.
  const askingFor = useRef<string | null>(null);
  const ai = useAiSubmit({
    accountId, userId, showToast: (m, t) => showToast(m, undefined, t === 'error' ? 'error' : undefined),
    getSourceJobId: () => askingFor.current,
    onOutOfCredits: () => navigate('/billing'),
    openInboxAfterSend: false,
  });
  const wasAsking = useRef(false);
  useEffect(() => {
    if (ai.preview) { wasAsking.current = true; return; }
    if (wasAsking.current) { wasAsking.current = false; onChanged(); }
  }, [ai.preview]); // eslint-disable-line react-hooks/exhaustive-deps
  const askResume = async (item: CardItem) => {
    askingFor.current = item.subject_id;
    const leads = await loadLeadsByIds('hotlist', [item.lead_id]);
    const lead = leads[item.lead_id];
    if (!lead) { showToast('Could not open this profile.', undefined, 'error'); return; }
    void ai.generate(lead);
  };

  const applyQuick = (item: CardItem) => {
    if (kind === 'job') void askResume(item);
    else if (item.lead?.source === 'career_site') applySite(item);
    else applyEmail(item, null, null);
  };

  const save = (item: CardItem) => {
    if (item.saved_at) {
      const restore = take(item);
      void setSaved(item.card_id, false).then(() => onChanged()).catch(() => restore());
      showToast('Removed from Saved', () => { restore(); void setSaved(item.card_id, true).then(() => onChanged()); });
      return;
    }
    const restore = take(item);
    void setSaved(item.card_id, true).then(() => onChanged()).catch(() => { restore(); showToast('Could not save.', undefined, 'error'); });
    showToast('Saved to History', () => { restore(); void setSaved(item.card_id, false).then(() => onChanged()); });
  };

  const dismiss = (item: CardItem) => {
    const restore = take(item);
    void dismissCard(item.card_id).catch(() => restore());
    showToast("Removed. It won't show again.", () => { restore(); void restoreCard(item.card_id); });
  };

  // Ask the poster for what the post leaves out (rate, visa, location). They
  // get an email with this user's name and email, so they can reply directly.
  const ask = async (item: CardItem, question: Question) => {
    if (!item.lead) return;
    setAsked((m) => ({ ...m, [item.lead_id]: [...(m[item.lead_id] ?? []), question] }));
    const { data, error } = await supabase.functions.invoke('ask-poster', { body: { lead_id: item.lead_id, question } });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const payload = ctx ? await ctx.json().catch(() => null) : null;
      setAsked((m) => ({ ...m, [item.lead_id]: (m[item.lead_id] ?? []).filter((q) => q !== question) }));
      showToast(payload?.error === 'no_email' ? 'This post has no email to ask.' : payload?.error === 'daily_limit' ? 'That is a lot of questions for today. Try again tomorrow.' : 'Could not ask right now.', undefined, 'error');
      return;
    }
    trackEvent('poster_asked', { question });
    const who = item.lead.poster?.split(' ')[0] || 'the poster';
    showToast(data?.emailed ? `Asked ${who}. They'll reply to your email.` : `Asked. ${who} already has this question; you're counted in.`);
  };

  const share = async (item: CardItem) => {
    if (!item.lead) return;
    const r = await shareLink(item.lead);
    if (r !== 'failed') recordLeadShare(item.lead_id, accountId, userId);
    if (r === 'copied') showToast('Link copied');
  };

  return { toast, setToast, showToast, gmailConnected, connectGmail, busy, appliedNow, applyEmail, applySite, askResume, applyQuick, save, dismiss, share, ask, asked, checkFrame, frame, setFrame, ai };
}
