import { Loader2, Mail, Send, Sparkles, Video } from 'lucide-react';
import { renderInvitePreview, type InvitePreviewLead } from '../lib/invite-preview';

// The draft, beside the matches.
//
// Nobody tries a feature whose output they cannot see. The top match is
// generated for real, so the pane opens on the actual email rather than a
// description of one. Every other card offers to generate and send its own in
// a single action — the local render is only a fallback for a screening
// invite, whose wording is a fixed template and so can be known for free.

type Props = {
  lead: (InvitePreviewLead & { id: string }) | null;
  senderName: string | undefined;
  isGenerating: boolean;
  onSend: () => void;
  /** Mobile: sits under the tapped card and grows to its content, instead of
   *  filling a fixed-height column beside the list. */
  inline?: boolean;
  /** The real generated email for this card, once there is one. */
  draft?: { subject: string; body: string } | null;
  /** Generate the real email for this card and send it, in one action. */
  onGenerateAndSend?: () => void;
  isSending?: boolean;
};

export default function AiMatchInvitePane({
  lead, senderName, isGenerating, onSend, inline = false, draft = null, onGenerateAndSend, isSending = false,
}: Props) {
  if (!lead) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 p-6 text-center dark:border-indigo-400/20 dark:bg-indigo-500/[0.05]">
        <p className="text-[12px] text-indigo-400 dark:text-indigo-300/70">Pick a match to see the message that goes out.</p>
      </div>
    );
  }

  const local = renderInvitePreview(lead, senderName);
  const isInvite = lead.kind === 'hotlist';
  const Icon = isInvite ? Video : Mail;
  // A generated draft wins over the local render; it is what will actually go
  // out, and for a submission the local render is only a description.
  const preview = draft
    ? { to: local.to, subject: draft.subject, body: draft.body, sendable: local.sendable }
    : local;
  const busy = isGenerating || isSending;
  // The banner stands in for the body on any card whose real email has not
  // been generated. A submission's wording is written per post, so showing the
  // local placeholder here would be describing an email while offering to send
  // a different one.
  const showBanner = !draft && !isInvite && Boolean(onGenerateAndSend) && local.sendable;

  return (
    // Tinted, not white. On a white card in a list of white cards this read
    // as one more match rather than the thing the matches are for, which is
    // the opposite of why it is on screen. The message itself stays on white
    // inside the tint, so it still looks like an email rather than a panel.
    <div className={`flex flex-col overflow-hidden rounded-xl border border-indigo-200 bg-indigo-50/70 dark:border-indigo-400/25 dark:bg-indigo-500/[0.07] ${
      inline ? '' : 'h-full'
    }`}>
      <div className="flex items-center gap-2 border-b border-indigo-200/70 bg-indigo-100/50 px-3.5 py-2.5 dark:border-indigo-400/20 dark:bg-indigo-500/10">
        <Icon size={14} className="shrink-0 text-indigo-600 dark:text-indigo-300" />
        <p className="text-[12px] font-semibold text-indigo-900 dark:text-indigo-100">
          {isInvite ? 'Screening invite' : 'Submission'}
        </p>
        <span className="ml-auto text-[10px] text-indigo-400 dark:text-indigo-300/60">
          {draft ? 'generated' : showBanner ? '' : 'preview'}
        </span>
      </div>

      {showBanner ? (
        // Fills the pane top to bottom, because there is nothing truthful to
        // put behind it: this card's email does not exist until it is asked
        // for. One action writes it and sends it.
        <div className={`flex flex-col items-center justify-center gap-2.5 px-5 text-center ${inline ? 'py-7' : 'flex-1'}`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600">
            <Sparkles size={18} className="text-white" />
          </span>
          <p className="text-[12.5px] font-semibold text-indigo-900 dark:text-indigo-100">
            Write and send this submission
          </p>
          <p className="max-w-[15rem] text-[11px] leading-snug text-indigo-500/90 dark:text-indigo-300/70">
            Written for this post, then emailed to {preview.to} straight away.
          </p>
          <button
            type="button"
            onClick={onGenerateAndSend}
            disabled={busy}
            className="mt-0.5 flex items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 px-5 py-2.5 text-[13px] font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {isSending ? 'Sending…' : isGenerating ? 'Writing…' : 'Generate & send'}
          </button>
          {/* Said before the click, because after it the email has gone. */}
          <p className="text-[10px] text-indigo-400 dark:text-indigo-300/60">1 credit · sends without another check</p>
        </div>
      ) : (
      <div className={`min-h-0 overflow-y-auto p-2.5 ${inline ? 'max-h-72' : 'flex-1'}`}>
        <div className="rounded-lg border border-indigo-100 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-[#171A1F]">
          <div className="mb-2 grid grid-cols-[42px_1fr] gap-y-1 border-b border-gray-100 pb-2 text-[11px] dark:border-white/10">
            <span className="text-gray-400">To</span>
            <span className="truncate text-gray-700 dark:text-slate-300">{preview.to || '—'}</span>
            <span className="text-gray-400">Subject</span>
            <span className="truncate font-medium text-gray-900 dark:text-slate-100">{preview.subject || '…'}</span>
          </div>
          {isGenerating && !draft ? (
            <div className="flex items-center gap-2 py-2 text-[12px] text-gray-400">
              <Loader2 size={13} className="animate-spin" />
              Writing this one…
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-gray-700 dark:text-slate-300">
              {preview.body}
            </p>
          )}
        </div>
      </div>
      )}

      <div className={`border-t border-indigo-200/70 p-2.5 dark:border-indigo-400/20 ${showBanner ? 'hidden' : ''}`}>
        {!preview.sendable ? (
          <p className="text-center text-[11px] text-indigo-400 dark:text-indigo-300/70">This one has no contact address.</p>
        ) : (
          <>
            <button
              type="button"
              onClick={onSend}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 py-2.5 text-[13px] font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
              {isSending ? 'Sending…' : isGenerating ? 'Preparing…' : isInvite ? 'AI Invite' : 'AI Submit'}
            </button>
            {/* Said before the click, not after: the draft above is free, the
                one that gets sent is not. */}
            <p className="mt-1.5 text-center text-[10px] text-indigo-400 dark:text-indigo-300/70">
              Costs 1 credit · you review it before it sends
            </p>
          </>
        )}
      </div>
    </div>
  );
}
