import { renderResumeRequest } from '../../supabase/functions/_shared/resume-request';

// What an AI Request (to a consultant's recruiter) or AI Submit will say,
// rendered locally.
//
// The point is showing someone the message before they spend anything on it.
// Generating the real draft costs a credit, so a preview pane that called the
// server would charge for every card somebody clicked through — ten credits to
// browse ten matches, which is the opposite of an invitation to try it.
//
// A resume request is a fixed template, imported from the same file the email
// function uses, so the preview is exactly what is sent.

export type InvitePreviewLead = {
  kind: 'job' | 'hotlist';
  roleTitle?: string;
  title?: string;
  posterName?: string;
  posterEmail?: string | null;
};

export type InvitePreview = {
  to: string;
  subject: string;
  body: string;
  /** False when the lead has no address, so the pane can say why not. */
  sendable: boolean;
};

function firstName(value: string | undefined | null, fallback: string): string {
  const name = (value ?? '').trim().split(/\s+/)[0] ?? '';
  return name || fallback;
}

export function renderInvitePreview(
  lead: InvitePreviewLead,
  senderName: string | undefined,
  requirement?: { title?: string | null; location?: string | null } | null,
): InvitePreview {
  const role = (lead.roleTitle || lead.title || 'consultant').trim();
  const recipient = firstName(lead.posterName, 'there');
  const to = (lead.posterEmail ?? '').trim();

  if (lead.kind === 'job') {
    // A job is a submission, and that copy is still written by the model, so
    // the exact words cannot be known ahead of time. Say what it will do
    // rather than inventing a sentence it might not use.
    return {
      to,
      subject: `Re: ${lead.title || 'your requirement'}`,
      body: `A short note to ${recipient} asking what is needed to submit a consultant for this role — written for this post when you send it.`,
      sendable: Boolean(to),
    };
  }

  // A consultant gets a resume request: the exact text that is sent, from the
  // template the email function also uses.
  const draft = renderResumeRequest({
    role,
    recipientName: lead.posterName,
    senderName,
    requirementTitle: requirement?.title,
    requirementLocation: requirement?.location,
  });
  return { to, subject: draft.subject, body: draft.body, sendable: Boolean(to) };
}
