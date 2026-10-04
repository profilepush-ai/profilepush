// A vendor's request to a bench sales recruiter about one of their consultants:
// resume, rate, visa and availability. The default vendor action (AI Request).
//
// One template, imported by both the ask-ai-vendor-email function (what is
// sent) and the app (the preview shown before sending), so the two can never
// say different things. Plain TypeScript, no Deno or browser APIs.
//
// It replaced the video screening invite as the default because nobody did
// the screening: 0 of 10 invites were recorded, while 3 of 3 plain resume
// requests got a resume back. The screening link is now an optional add-on.

/** What a resume request asks for; also its missing_details on the request. */
export const RESUME_REQUEST_DETAILS = ['resume', 'rate', 'visa', 'availability'];

export function isResumeRequest(missingDetails: string[]): boolean {
  return missingDetails.some((detail) => detail.trim().toLowerCase() === 'resume');
}

function firstName(value: string | null | undefined, fallback: string): string {
  const name = (value ?? '').trim().split(/\s+/)[0] ?? '';
  return name || fallback;
}

export function renderResumeRequest(input: {
  /** The consultant's role, e.g. "Java Developer". */
  role: string | null | undefined;
  recipientName: string | null | undefined;
  senderName: string | null | undefined;
  /** The vendor's own requirement this is for, when known. */
  requirementTitle?: string | null;
  requirementLocation?: string | null;
}): { subject: string; body: string } {
  const role = (input.role ?? '').trim() || 'consultant';
  const requirement = (input.requirementTitle ?? '').trim();
  const location = (input.requirementLocation ?? '').trim();
  const what = requirement
    ? `a ${requirement} requirement${location ? ` (${location})` : ''}`
    : 'a live requirement';
  return {
    subject: `${role}: resume and rate?`,
    body: [
      `Hi ${firstName(input.recipientName, 'there')},`,
      '',
      `I have ${what} that fits your ${role} consultant. Could you share their resume, rate, visa status and availability?`,
      '',
      firstName(input.senderName, 'Recruiter'),
    ].join('\n'),
  };
}
