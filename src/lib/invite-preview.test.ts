import { describe, expect, it } from 'vitest';
import { renderInvitePreview } from './invite-preview';

const consultant = {
  kind: 'hotlist' as const,
  roleTitle: 'Senior React Developer',
  posterName: 'Gopal Reddy',
  posterEmail: 'gopal@tecshaper.com',
};

describe('renderInvitePreview', () => {
  it('is the resume request the email function sends', () => {
    // Both render from supabase/functions/_shared/resume-request.ts; this pins
    // the wording so a change to it is a deliberate one.
    const preview = renderInvitePreview(consultant, 'Poorna Potluri');
    expect(preview.subject).toBe('Senior React Developer: resume and rate?');
    expect(preview.body).toBe(
      'Hi Gopal,\n\n'
      + 'I have a live requirement that fits your Senior React Developer consultant. Could you share their resume, rate, visa status and availability?\n\n'
      + 'Poorna',
    );
  });

  it('names the vendor requirement when there is one', () => {
    const preview = renderInvitePreview(consultant, 'Poorna', { title: 'React Lead', location: 'Dallas, TX' });
    expect(preview.body).toContain('I have a React Lead requirement (Dallas, TX) that fits');
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
