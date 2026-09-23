// What an AI Invite will say, rendered locally.
//
// The point is showing someone the message before they spend anything on it.
// Generating the real draft costs a credit, so a preview pane that called the
// server would charge for every card somebody clicked through — ten credits to
// browse ten matches, which is the opposite of an invitation to try it.
//
// It costs nothing here because the copy is no longer model-written: the
// prompt in social-job-queue-consumer is a fixed template with two
// substitutions, and the fallback beside it is the same sentence. So the exact
// text can be produced on the client.
//
// The consequence is that this must be kept in step with that worker. If the
// two drift, someone reads one message and sends another — which is worse than
// showing nothing. The test pins the wording.

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
  screeningLinkPlaceholder = 'https://profilepush.ai/screen/…',
): InvitePreview {
  const role = (lead.roleTitle || lead.title || 'consultant').trim();
  const recipient = firstName(lead.posterName, 'there');
  const sender = firstName(senderName, 'Recruiter');
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

  return {
    to,
    subject: `Screening invite: ${role}`,
    body: [
      `Hi ${recipient},`,
      '',
      `I have a live ${role} requirement that fits your hotlist consultant.`,
      '',
      'To submit: share the screening link with your consultant and ask them to attach the resume and complete the 5-minute video screening.',
      '',
      'Link:',
      screeningLinkPlaceholder,
      '',
      sender,
    ].join('\n'),
    sendable: Boolean(to),
  };
}
