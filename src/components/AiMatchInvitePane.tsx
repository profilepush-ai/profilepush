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
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white/50 p-6 text-center dark:border-white/10 dark:bg-white/[0.02]">
        <p className="text-[12px] text-gray-400">Pick a match to see the message that goes out.</p>
      </div>
    );
  }

  const preview = renderInvitePreview(lead, senderName);
  const isInvite = lead.kind === 'hotlist';
  const Icon = isInvite ? Video : Mail;

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border bg-white dark:bg-[#171A1F] ${
      inline ? 'border-indigo-300 dark:border-indigo-400/30' : 'h-full border-gray-200 dark:border-white/10'
    }`}>
      <div className="flex items-center gap-2 border-b border-gray-100 px-3.5 py-2.5 dark:border-white/10">
        <Icon size={14} className="shrink-0 text-indigo-500" />
        <p className="text-[12px] font-semibold text-gray-900 dark:text-slate-100">
          {isInvite ? 'Screening invite' : 'Submission'}
        </p>
        <span className="ml-auto text-[10px] text-gray-400">preview</span>
      </div>

      <div className={`min-h-0 overflow-y-auto px-3.5 py-3 ${inline ? 'max-h-72' : 'flex-1'}`}>
        <div className="mb-2 grid grid-cols-[42px_1fr] gap-y-1 text-[11px]">
          <span className="text-gray-400">To</span>
          <span className="truncate text-gray-700 dark:text-slate-300">{preview.to || '—'}</span>
          <span className="text-gray-400">Subject</span>
          <span className="truncate font-medium text-gray-900 dark:text-slate-100">{preview.subject}</span>
        </div>
        <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-gray-700 dark:text-slate-300">
          {preview.body}
        </p>
      </div>

      <div className="border-t border-gray-100 p-2.5 dark:border-white/10">
        {!preview.sendable ? (
          <p className="text-center text-[11px] text-gray-400">This one has no contact address.</p>
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
            <p className="mt-1.5 text-center text-[10px] text-gray-400">
              Costs 1 credit · you review it before it sends
            </p>
          </>
        )}
      </div>
    </div>
  );
}
