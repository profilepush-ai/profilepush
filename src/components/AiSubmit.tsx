import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Paperclip, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { withOptionalScreeningLink } from '../lib/screening-link';
import { trackEvent } from '../lib/track';
import { RESUME_REQUEST_DETAILS } from '../../supabase/functions/_shared/resume-request';
import { requestFeedback } from '../lib/feedback';
import GmailIcon from './GmailIcon';
import GmailConnectPrompt from './GmailConnectPrompt';
import LogoSpinner from './LogoSpinner';
import { extractPrimaryEmail, getMissingJobDetails, type SocialLead } from './LeadCard';

// AI Submit / AI Request: generate the email for a lead, review it, send it
// from the user's Gmail. Shared by every page that offers it (Feed, AI Match,
// Tracker) so the draft, the screening link, credits and Gmail all behave the
// same everywhere. useAiSubmit holds the state and actions; AiSubmitDialog is
// the review popup.

export type AskAIPreview = {
  leadId: string;
  leadType: 'job' | 'hotlist';
  requestId: string;
  vendorName: string;
  vendorEmail: string;
  jobTitle: string;
  company: string;
  missingDetails: string[];
  emailSubject: string;
  emailContent: string;
  /** Why a screening link is missing, when one is. Shown in the modal. */
  screeningNotice?: string | null;
  /** Resume requests: the vendor's requirement a screening link can hang off. */
  screeningJobId?: string | null;
  /** Resume requests: add the optional video screening link when sending. */
  includeScreening?: boolean;
  /** AI Submit: the consultant's resume, sent as an attachment. */
  resume?: { url: string; name: string } | null;
  /** AI Submit: every resume the consultant has, when there is a choice. */
  resumeOptions?: Array<{ url: string; name: string }>;
  isGenerating: boolean;
  /** Generated for the AI Match pane, which renders it itself. Keeps the
   *  modal closed: the whole point of the pane is not opening one. */
  inline?: boolean;
};

export async function getFunctionErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { error?: unknown } | null;
      if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
    }
  }
  return error instanceof Error && error.message !== 'Edge Function returned a non-2xx status code'
    ? error.message
    : fallback;
}

export async function getFunctionErrorCode(error: unknown): Promise<string | null> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { code?: unknown } | null;
      if (typeof payload?.code === 'string') return payload.code;
    }
  }
  return null;
}

export function removeNameFromEmail(text: string, name: string) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return text;
  const escapedName = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escapedName, 'gi'), 'there');
}

export type UseAiSubmitOptions = {
  accountId: string | null | undefined;
  userId: string | null | undefined;
  showToast: (message: string, type?: 'success' | 'error') => void;
  /** The requirement an invite's screening link hangs off, when there is one. */
  getSourceJobId?: () => string | null;
  /** AI Submit: the consultant resume to attach, when the page knows one. */
  getResume?: () => { url: string; name: string } | null;
  /** AI Submit: all of the consultant's resumes, to pick one per send. */
  getResumeOptions?: () => Array<{ url: string; name: string }>;
  /** Defaults to lead.kind. The Feed passes its own rule for single-kind feeds. */
  isHotlist?: (lead: SocialLead) => boolean;
  /** Out of credits: the page shows its credits prompt for this action. */
  onOutOfCredits: (action: string | null) => void;
  /** After a modal send, open the conversation in the Inbox (default true). */
  openInboxAfterSend?: boolean;
};

export function useAiSubmit(options: UseAiSubmitOptions) {
  const navigate = useNavigate();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { accountId, userId, openInboxAfterSend = true } = options;
  const showToast = useCallback((message: string, type?: 'success' | 'error') => optionsRef.current.showToast(message, type), []);
  const isHotlist = useCallback((lead: SocialLead) => (optionsRef.current.isHotlist ? optionsRef.current.isHotlist(lead) : lead.kind === 'hotlist'), []);
  const getSourceJobId = () => optionsRef.current.getSourceJobId?.() ?? null;
  const onOutOfCredits = (action: string | null) => optionsRef.current.onOutOfCredits(action);

  const [processingAskAILeadId, setProcessingAskAILeadId] = useState<string | null>(null);
  const [askAIPreview, setAskAIPreview] = useState<AskAIPreview | null>(null);
  const [gmailIntegrationStatus, setGmailIntegrationStatus] = useState<'connected' | 'not_connected' | null>(null);
  const [sendingViaGmail, setSendingViaGmail] = useState(false);
  const [showGmailConnectPrompt, setShowGmailConnectPrompt] = useState(false);
  const [connectingGmail, setConnectingGmail] = useState(false);

  const handleAskAI = useCallback(async (lead: SocialLead, options?: { inline?: boolean }): Promise<AskAIPreview | null> => {
    if (!accountId || processingAskAILeadId) return null;
    const inline = options?.inline === true;

    const leadType: 'job' | 'hotlist' = isHotlist(lead) ? 'hotlist' : 'job';
    // A job with every field already detected still has a valid "ask" — re-confirming
    // rate is always a safe, relevant question, so we never block sending outreach.
    // A consultant gets a resume request (resume, rate, visa, availability);
    // the video screening is an optional add-on chosen in the dialog.
    const detectedMissingDetails = leadType === 'hotlist' ? RESUME_REQUEST_DETAILS : getMissingJobDetails(lead);
    const missingDetails = detectedMissingDetails.length > 0 ? detectedMissingDetails : ['Rate'];
    const primaryEmail = extractPrimaryEmail(lead.posterEmail);
    if (!primaryEmail) {
      showToast(leadType === 'hotlist' ? 'This consultant does not have a valid recruiter email' : 'This job does not have a valid vendor email', 'error');
      return null;
    }

    const requestId = crypto.randomUUID();
    trackEvent('ai_request_started', { lead_type: leadType, inline });
    setAskAIPreview({
      leadId: lead.id,
      leadType,
      requestId,
      vendorName: lead.posterName || 'the vendor',
      vendorEmail: primaryEmail,
      jobTitle: lead.title || lead.roleTitle || '',
      company: lead.company || '',
      missingDetails,
      emailSubject: '',
      emailContent: '',
      isGenerating: true,
      inline,
    });
    setProcessingAskAILeadId(lead.id);
    try {
      const { data, error } = await supabase.functions.invoke('ask-ai-vendor-email', {
        body: {
          action: 'preview',
          request_id: requestId,
          account_id: accountId,
          job_id: lead.id,
          lead_type: leadType,
          missing_details: missingDetails,
          source_job_id: leadType === 'hotlist' ? getSourceJobId() : null,
        },
      });

      if (error || !data?.ok) {
        const code = await getFunctionErrorCode(error);
        if (code === 'insufficient_credits') {
          const insufficientCreditsError = new Error('insufficient_credits');
          insufficientCreditsError.name = 'InsufficientCreditsError';
          throw insufficientCreditsError;
        }
        throw new Error(data?.error || await getFunctionErrorMessage(error, 'Could not generate the request'));
      }

      const vendorName = data.vendor_name || lead.posterName || 'the vendor';
      const vendorEmail = primaryEmail;
      // A resume request is our own template, already addressed by first
      // name exactly as the preview shows it; only model-written drafts have
      // the vendor's name taken out.
      const generatedSubject = leadType === 'hotlist' ? (data.email_subject || '') : removeNameFromEmail(data.email_subject || '', vendorName);
      const generatedContent = leadType === 'hotlist' ? (data.email_content || '') : removeNameFromEmail(data.email_content || '', vendorName);
      const screeningJobId = leadType === 'hotlist' ? getSourceJobId() : null;
      const resume = leadType === 'job' ? optionsRef.current.getResume?.() ?? null : null;
      const resumeOptions = leadType === 'job' ? optionsRef.current.getResumeOptions?.() ?? [] : [];
      // Built as a value rather than a state updater so the caller can send
      // it straight away: "generate and send" cannot wait for a re-render to
      // read the draft back out of state.
      const finalPreview: AskAIPreview = {
        leadId: lead.id,
        leadType,
        requestId,
        vendorName,
        vendorEmail,
        jobTitle: lead.title || lead.roleTitle || '',
        company: lead.company || '',
        missingDetails,
        emailSubject: generatedSubject,
        emailContent: generatedContent,
        screeningJobId,
        includeScreening: false,
        resume,
        resumeOptions,
        isGenerating: false,
        inline,
      };
      setAskAIPreview(finalPreview);
      trackEvent('ai_request_drafted', { lead_type: leadType, inline, has_requirement: Boolean(screeningJobId) });

      // Log every generated email to the Inbox — nothing currently gets sent
      // (Gmail Sync isn't wired up), so this is the only record of it. One
      // row per (user, lead): regenerating just refreshes it.
      if (userId) {
        void supabase.from('pulse_ask_ai_previews' as never).upsert({
          account_id: accountId,
          user_id: userId,
          job_id: leadType === 'job' ? lead.id : null,
          hotlist_id: leadType === 'hotlist' ? lead.id : null,
          vendor_name: vendorName,
          vendor_email: vendorEmail,
          subject: generatedSubject,
          email_content: generatedContent,
          updated_at: new Date().toISOString(),
        } as never, { onConflict: 'user_id,lead_key' } as never).then(({ error: previewError }) => {
          if (previewError) {
            console.error('Could not log generated email to Inbox', previewError);
            showToast('Email generated, but could not be saved to Inbox', 'error');
          }
        });
      }
      return finalPreview;
    } catch (error) {
      setAskAIPreview(null);
      if (error instanceof Error && error.name === 'InsufficientCreditsError') {
        onOutOfCredits(null);
      } else {
        showToast(error instanceof Error ? error.message : 'Could not generate the vendor email request', 'error');
      }
      return null;
    } finally {
      setProcessingAskAILeadId(null);
    }
  }, [accountId, isHotlist, processingAskAILeadId, showToast, userId]);

  useEffect(() => {
    supabase
      .from('gmail_integration_status' as never)
      .select('status')
      .maybeSingle()
      .then(({ data }: { data: { status?: string } | null }) => {
        setGmailIntegrationStatus(data?.status === 'connected' ? 'connected' : 'not_connected');
      });
  }, []);

  // Mirrors AccountSettings.connectGmail — full-page redirect to Google's
  // consent screen, so the in-progress draft in askAIPreview is lost from
  // memory. return_to (this page + which lead to reopen) rides through the
  // signed OAuth state and back; the restore effect below uses it to
  // reopen the modal with the draft pulled back from pulse_ask_ai_previews
  // (or regenerated if that row is somehow gone) once we're back here.
  // The bulk bar can offer Gmail before any draft exists, so it cannot reuse
  // handleConnectGmail, which returns the user to a specific lead's modal.
  async function handleConnectGmailStandalone() {
    if (!accountId || connectingGmail) return;
    setConnectingGmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-oauth-start', {
        body: { account_id: accountId, return_to: window.location.pathname, return_origin: window.location.origin },
      });
      if (error || !data?.url) throw new Error(data?.error || 'Could not start Gmail connection');
      window.location.href = data.url;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start Gmail connection', 'error');
      setConnectingGmail(false);
    }
  }

  async function handleConnectGmail() {
    if (!accountId || connectingGmail || !askAIPreview) return;
    setConnectingGmail(true);
    try {
      const returnTo = `${window.location.pathname}?gmail_reopen_lead=${encodeURIComponent(askAIPreview.leadId)}&gmail_reopen_type=${askAIPreview.leadType}`;
      const { data, error } = await supabase.functions.invoke('gmail-oauth-start', { body: { account_id: accountId, return_to: returnTo, return_origin: window.location.origin } });
      if (error || !data?.url) throw new Error(data?.error || 'Could not start Gmail connection');
      window.location.href = data.url;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start Gmail connection', 'error');
      setConnectingGmail(false);
    }
  }

  // Takes an explicit draft so the AI Match pane can send the one it just
  // generated, without waiting for a re-render to read it back from state.
  async function handleSendViaGmail(draft?: AskAIPreview) {
    const preview = draft ?? askAIPreview;
    if (!preview || !accountId || sendingViaGmail) return;
    setSendingViaGmail(true);
    try {
      // An invite without the link is just an email. Minted at send time
      // rather than when the draft is generated, so a draft the user abandons
      // does not leave a screening record behind.
      let emailContent = preview.emailContent;
      // The video screening is opt-in on a resume request. Minted only when
      // ticked, at send, so an unsent or plain request leaves no screening.
      if (preview.leadType === 'hotlist' && preview.includeScreening && preview.screeningJobId) {
        const { data: invite } = await supabase.rpc('invite_consultant_to_screening' as never, {
          p_social_job_id: preview.screeningJobId,
          p_hotlist_id: preview.leadId,
        } as never);
        const row = Array.isArray(invite) ? invite[0] : invite;
        const token = (row as { screening_token?: string } | null)?.screening_token;
        if (token) {
          emailContent = withOptionalScreeningLink(emailContent, `${window.location.origin}/screen/${token}`);
        }
      }

      const { data, error } = await supabase.functions.invoke('ask-ai-vendor-email', {
        body: {
          action: 'send',
          send_source: 'single',
          request_id: preview.requestId,
          account_id: accountId,
          job_id: preview.leadId,
          lead_type: preview.leadType,
          missing_details: preview.missingDetails,
          email_subject: preview.emailSubject,
          email_content: emailContent,
          channel: 'gmail',
          ...(preview.resume ? { resume_url: preview.resume.url, resume_file_name: preview.resume.name } : {}),
        },
      });
      if (error || !data?.ok) {
        if (data?.error === 'gmail_not_connected') {
          setGmailIntegrationStatus('not_connected');
          throw new Error('Gmail is no longer connected — reconnect and try again');
        }
        if (await getFunctionErrorCode(error) === 'insufficient_credits') {
          onOutOfCredits('send this email');
          return;
        }
        throw new Error(data?.error || await getFunctionErrorMessage(error, 'Could not send via Gmail'));
      }
      setAskAIPreview(null);
      trackEvent('ai_request_sent', { lead_type: preview.leadType, inline: Boolean(preview.inline), include_screening: Boolean(preview.includeScreening) });
      showToast('Sent via Gmail', 'success');
      requestFeedback('ai_submit');
      // An inline send happens beside the results the person is working
      // through; jumping them to the Inbox would lose their place.
      if (data.conversation_id && !preview.inline && openInboxAfterSend) navigate(`/inbox/${data.conversation_id}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not send via Gmail', 'error');
    } finally {
      setSendingViaGmail(false);
    }
  }

  const copyText = useCallback(async (value: string, label: string) => {
    if (!value.trim()) {
      showToast(`${label} is not available on this lead`, 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(value.trim());
      showToast(`${label} copied`, 'success');
    } catch {
      showToast(`Could not copy ${label.toLowerCase()}`, 'error');
    }
  }, [showToast]);

  return {
    preview: askAIPreview,
    setPreview: setAskAIPreview,
    processingLeadId: processingAskAILeadId,
    sending: sendingViaGmail,
    gmailStatus: gmailIntegrationStatus,
    connectingGmail,
    showGmailPrompt: showGmailConnectPrompt,
    setShowGmailPrompt: setShowGmailConnectPrompt,
    generate: handleAskAI,
    send: handleSendViaGmail,
    connectGmail: handleConnectGmail,
    connectGmailStandalone: handleConnectGmailStandalone,
    copyText,
  };
}

export type AiSubmit = ReturnType<typeof useAiSubmit>;

// The review popup. Inline drafts (the AI Match pane) render themselves, so
// this stays closed for them. screeningExtra is a page's own addition under
// a missing-screening-link notice (AI Match offers to pick a job there).
export function AiSubmitDialog({ ai, screeningExtra }: { ai: AiSubmit; screeningExtra?: ReactNode }) {
  const {
    preview: askAIPreview, setPreview: setAskAIPreview, processingLeadId: processingAskAILeadId,
    sending: sendingViaGmail, gmailStatus: gmailIntegrationStatus, connectingGmail,
    showGmailPrompt: showGmailConnectPrompt, setShowGmailPrompt: setShowGmailConnectPrompt,
    send: handleSendViaGmail, connectGmail: handleConnectGmail, copyText,
  } = ai;
  // Closing an unsent draft is the drop-off worth measuring.
  const dismiss = () => {
    if (askAIPreview && !askAIPreview.isGenerating) trackEvent('ai_request_dismissed', { lead_type: askAIPreview.leadType });
    setAskAIPreview(null);
  };
  return (
    <>
    {/* Inline drafts belong to the AI Match pane, which renders them
        itself. Opening a modal over them would undo the point of it. */}
    {askAIPreview && !askAIPreview.inline && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => !processingAskAILeadId && dismiss()}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ask-ai-preview-title"
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
        >
          <div className="flex items-start gap-2.5">
            <div className="min-w-0 flex-1">
              <h2 id="ask-ai-preview-title" className="text-[15px] font-semibold text-gray-900">{askAIPreview.isGenerating ? (askAIPreview.leadType === 'hotlist' ? 'Preparing resume request' : 'Generating email draft for submission') : (askAIPreview.leadType === 'hotlist' ? 'Review resume request' : 'Review submission')}</h2>
              {!askAIPreview.isGenerating && (askAIPreview.jobTitle || askAIPreview.company) && (
                <p className="mt-0.5 truncate text-[13px] text-gray-500">
                  {askAIPreview.jobTitle}{askAIPreview.jobTitle && askAIPreview.company ? ' · ' : ''}{askAIPreview.company}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={dismiss}
              disabled={Boolean(processingAskAILeadId)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
              aria-label="Close email preview"
            >
              <X size={14} />
            </button>
          </div>
          {askAIPreview.isGenerating ? (
            <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
              <LogoSpinner size={28} />
              <p className="mt-4 text-[13px] leading-relaxed text-gray-500">{askAIPreview.leadType === 'hotlist' ? 'Preparing the resume request' : 'Generating email draft for submission'}</p>
            </div>
          ) : <>
          <div className="mt-3 divide-y divide-gray-100 border-y border-gray-100 text-[13px]">
            <div className="flex items-center gap-2 py-2">
              <span className="w-14 shrink-0 text-gray-400">To</span>
              <span className="min-w-0 flex-1 truncate text-gray-900">{askAIPreview.vendorEmail || 'No email on file'}</span>
              <button
                type="button"
                onClick={() => void copyText(askAIPreview.vendorEmail, 'Email ID')}
                disabled={!askAIPreview.vendorEmail}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Copy email ID"
              >
                <Copy size={12} />
              </button>
            </div>
            <div className="flex items-center gap-2 py-2">
              <span className="w-14 shrink-0 text-gray-400">Subject</span>
              <input
                value={askAIPreview.emailSubject}
                onChange={(event) => setAskAIPreview((current) => current ? { ...current, emailSubject: event.target.value } : current)}
                disabled={Boolean(processingAskAILeadId)}
                placeholder="Subject"
                className="min-w-0 flex-1 bg-transparent font-medium text-gray-900 outline-none"
              />
              <button
                type="button"
                onClick={() => void copyText(askAIPreview.emailSubject, 'Subject')}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Copy subject"
              >
                <Copy size={12} />
              </button>
            </div>
            <div className="relative py-2">
              <textarea
                value={askAIPreview.emailContent}
                onChange={(event) => setAskAIPreview((current) => current ? { ...current, emailContent: event.target.value } : current)}
                disabled={Boolean(processingAskAILeadId)}
                rows={6}
                placeholder="Write your message..."
                className="w-full resize-none bg-transparent pr-7 leading-relaxed text-gray-900 outline-none"
              />
              <button
                type="button"
                onClick={() => void copyText(askAIPreview.emailContent, 'Email body')}
                className="absolute right-0 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Copy email body"
              >
                <Copy size={12} />
              </button>
            </div>
          </div>
          {askAIPreview.resume && (
            <div className="mt-3 flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-[12px] text-gray-700">
              <Paperclip size={12} className="shrink-0 text-gray-500" />
              {(askAIPreview.resumeOptions?.length ?? 0) > 1 ? (
                <select
                  value={askAIPreview.resume.url}
                  onChange={(e) => {
                    const picked = askAIPreview.resumeOptions?.find((r) => r.url === e.target.value);
                    if (picked) setAskAIPreview((current) => current ? { ...current, resume: picked } : current);
                  }}
                  aria-label="Resume to attach"
                  className="min-w-0 flex-1 truncate bg-transparent outline-none"
                >
                  {askAIPreview.resumeOptions?.map((r) => <option key={r.url} value={r.url}>{r.name}</option>)}
                </select>
              ) : (
                <a href={askAIPreview.resume.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{askAIPreview.resume.name}</a>
              )}
              <button
                type="button"
                onClick={() => setAskAIPreview((current) => current ? { ...current, resume: null } : current)}
                className="shrink-0 text-gray-400 hover:text-gray-600"
                aria-label="Don't attach the resume"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {askAIPreview.leadType === 'hotlist' && askAIPreview.screeningJobId && (
            // Opt-in: the resume request stands on its own. Ticking it adds a
            // link where the consultant can record a 5-minute video screening.
            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-md bg-gray-50 px-3 py-2 text-[12px] leading-snug text-gray-700">
              <input
                type="checkbox"
                checked={Boolean(askAIPreview.includeScreening)}
                onChange={(event) => setAskAIPreview((current) => current ? { ...current, includeScreening: event.target.checked } : current)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-blue-600"
              />
              <span>Also include a video screening link <span className="text-gray-400">(optional for the consultant)</span></span>
            </label>
          )}
          {askAIPreview.screeningNotice && (
            // Every earlier version failed silently here: a missing link
            // looked the same whether the job was absent, the function was
            // undeployed, or the consultant had no address.
            <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-800">
              <p>{askAIPreview.screeningNotice}</p>
              {screeningExtra}
            </div>
          )}
          {gmailIntegrationStatus === 'connected' ? (
            <button
              type="button"
              onClick={() => void handleSendViaGmail()}
              disabled={sendingViaGmail || !askAIPreview.vendorEmail || !askAIPreview.emailSubject.trim() || !askAIPreview.emailContent.trim()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sendingViaGmail ? <LogoSpinner size={13} /> : <GmailIcon size={14} />}
              {sendingViaGmail ? 'Sending…' : 'Send via Gmail'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowGmailConnectPrompt(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700"
            >
              <GmailIcon size={14} />
              Connect Gmail to Send (takes 30 seconds)
            </button>
          )}
          </>}
        </div>
      </div>
    )}

    {showGmailConnectPrompt && (
      <GmailConnectPrompt
        connecting={connectingGmail}
        onClose={() => setShowGmailConnectPrompt(false)}
        onConnect={() => void handleConnectGmail()}
      />
    )}
    </>
  );
}
