import { Loader2, Mail, Video } from 'lucide-react';
import { renderInvitePreview, type InvitePreviewLead } from '../lib/invite-preview';

// The draft, beside the matches, before anything is spent.
//
// Nobody tries a feature whose output they cannot see. This shows the exact
// message that will go out for whichever card is selected — rendered locally,
// so clicking through ten matches costs nothing. The credit is spent when Send
// is pressed, which opens the same review modal the card button does; this pane
// replaces the guessing, not the confirmation.

type Props = {
  lead: (InvitePreviewLead & { id: string }) | null;
  senderName: string | undefined;
  isGenerating: boolean;
  onSend: () => void;
  /** Mobile: sits under the tapped card and grows to its content, instead of
   *  filling a fixed-height column beside the list. */
  inline?: boolean;
};

export default function AiMatchInvitePane({ lead, senderName, isGenerating, onSend, inline = false }: Props) {
  if (!lead) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 p-6 text-center dark:border-indigo-400/20 dark:bg-indigo-500/[0.05]">
        <p className="text-[12px] text-indigo-400 dark:text-indigo-300/70">Pick a match to see the message that goes out.</p>
      </div>
    );
  }

  const preview = renderInvitePreview(lead, senderName);
  const isInvite = lead.kind === 'hotlist';
  const Icon = isInvite ? Video : Mail;

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
        <span className="ml-auto text-[10px] text-indigo-400 dark:text-indigo-300/60">preview</span>
      </div>

      <div className={`min-h-0 overflow-y-auto p-2.5 ${inline ? 'max-h-72' : 'flex-1'}`}>
        <div className="rounded-lg border border-indigo-100 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-[#171A1F]">
          <div className="mb-2 grid grid-cols-[42px_1fr] gap-y-1 border-b border-gray-100 pb-2 text-[11px] dark:border-white/10">
            <span className="text-gray-400">To</span>
            <span className="truncate text-gray-700 dark:text-slate-300">{preview.to || '—'}</span>
            <span className="text-gray-400">Subject</span>
            <span className="truncate font-medium text-gray-900 dark:text-slate-100">{preview.subject}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-gray-700 dark:text-slate-300">
            {preview.body}
          </p>
        </div>
      </div>

      <div className="border-t border-indigo-200/70 p-2.5 dark:border-indigo-400/20">
        {!preview.sendable ? (
          <p className="text-center text-[11px] text-indigo-400 dark:text-indigo-300/70">This one has no contact address.</p>
        ) : (
          <>
            <button
              type="button"
              onClick={onSend}
              disabled={isGenerating}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 py-2.5 text-[13px] font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
              {isGenerating ? 'Preparing…' : isInvite ? 'AI Invite' : 'AI Submit'}
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
