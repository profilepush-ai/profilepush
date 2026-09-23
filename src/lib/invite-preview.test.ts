import { describe, expect, it } from 'vitest';
import { renderInvitePreview } from './invite-preview';

const consultant = {
  kind: 'hotlist' as const,
  roleTitle: 'Senior React Developer',
  posterName: 'Gopal Reddy',
  posterEmail: 'gopal@tecshaper.com',
};

describe('renderInvitePreview', () => {
  it('matches the wording the worker sends', () => {
    // If this drifts from social-job-queue-consumer, someone reads one message
    // and sends another. That is worse than showing no preview at all.
    const preview = renderInvitePreview(consultant, 'Poorna Potluri', 'https://profilepush.ai/screen/ABC');
    expect(preview.subject).toBe('Screening invite: Senior React Developer');
    expect(preview.body).toBe(
      'Hi Gopal,\n\n'
      + 'I have a live Senior React Developer requirement that fits your hotlist consultant.\n\n'
      + 'To submit: share the screening link with your consultant and ask them to attach the resume and complete the 5-minute video screening.\n\n'
      + 'Link:\nhttps://profilepush.ai/screen/ABC\n\n'
      + 'Poorna',
    );
  });

  it('uses first names on both sides', () => {
    const preview = renderInvitePreview(consultant, 'Poorna Potluri');
    expect(preview.body.startsWith('Hi Gopal,')).toBe(true);
    expect(preview.body.endsWith('Poorna')).toBe(true);
  });

  it('falls back when either name is missing', () => {
    const preview = renderInvitePreview({ ...consultant, posterName: '' }, '');
    expect(preview.body.startsWith('Hi there,')).toBe(true);
    expect(preview.body.endsWith('Recruiter')).toBe(true);
  });

  it('marks a consultant with no address as unsendable', () => {
    expect(renderInvitePreview({ ...consultant, posterEmail: '' }, 'Poorna').sendable).toBe(false);
    expect(renderInvitePreview(consultant, 'Poorna').sendable).toBe(true);
  });

  it('does not invent wording for a job submission', () => {
    // That copy is still model-written, so the exact sentence is unknowable
    // until it is generated.
    const preview = renderInvitePreview(
      { kind: 'job', title: 'Salesforce Architect', posterName: 'Ravi', posterEmail: 'r@x.com' },
      'Poorna',
    );
    expect(preview.subject).toBe('Re: Salesforce Architect');
    expect(preview.body).toContain('written for this post when you send it');
  });
});
