// The enquiry goals a generated site can be built around, and their forms.
// The generator picks the 2–3 that fit the firm (a training-and-placement
// firm wants consultant sign-ups, hiring requests and course enquiries; a
// staffing vendor wants candidates and vendor partners). Every template
// renders the same forms, so submissions look the same in the admin portal.
//
// A form posts enquiry_type = the goal id; the website-host Worker stores it
// as website_submissions.kind.

export type GoalId = 'candidate' | 'consultant' | 'employer' | 'partner' | 'training';

type Field =
  | { k: 'text' | 'email' | 'tel' | 'url'; name: string; label: string; required?: boolean; full?: boolean; auto?: string }
  | { k: 'select'; name: string; label: string; options: string[] | 'skills' | 'courses'; required?: boolean; full?: boolean }
  | { k: 'textarea'; name: string; label: string; required?: boolean }
  | { k: 'resume' }
  | { k: 'choices'; name: string; legend: string; multi?: boolean; options: string[] };

type GoalDef = { tab: string; submit: string; consent: string; done: string; fields: Field[] };

const VISA = ['US Citizen', 'Green Card', 'H-1B', 'H-4 EAD', 'OPT / STEM OPT', 'CPT', 'Other'];
const EXPERIENCE = ['0–2 years', '3–5 years', '6–9 years', '10+ years'];

export const GOALS: Record<GoalId, GoalDef> = {
  candidate: {
    tab: "I'm looking for a job",
    submit: 'Submit my profile',
    consent: 'By submitting, you agree that {company} may contact you about job opportunities.',
    done: 'Your profile is on its way.',
    fields: [
      { k: 'choices', name: 'engagement', legend: "I'm looking for", options: ['Contract', 'Contract-to-hire', 'Full-time', 'Open to all'] },
      { k: 'text', name: 'name', label: 'Full name', required: true, auto: 'name' },
      { k: 'email', name: 'email', label: 'Email', required: true, auto: 'email' },
      { k: 'tel', name: 'phone', label: 'Phone', required: true, auto: 'tel' },
      { k: 'select', name: 'primary_skill', label: 'Primary skill', options: 'skills', required: true },
      { k: 'select', name: 'experience', label: 'Experience', options: EXPERIENCE },
      { k: 'select', name: 'work_authorization', label: 'Work authorization', options: VISA },
      { k: 'text', name: 'location', label: 'Current location', auto: 'address-level2' },
      { k: 'select', name: 'availability', label: 'Availability', options: ['Immediately', '2 weeks', '30 days', 'Just exploring'] },
      { k: 'url', name: 'linkedin', label: 'LinkedIn URL', full: true },
      { k: 'resume' },
      { k: 'textarea', name: 'message', label: 'Anything else we should know?' },
    ],
  },
  consultant: {
    tab: 'Join as a consultant',
    submit: 'Apply to the program',
    consent: 'By applying, you agree that {company} may contact you about the program and job opportunities.',
    done: 'Your application is on its way.',
    fields: [
      { k: 'choices', name: 'track_stage', legend: 'Where are you today?', options: ['Student / OPT', 'Working, want to switch', 'Experienced, need projects', 'Career break'] },
      { k: 'text', name: 'name', label: 'Full name', required: true, auto: 'name' },
      { k: 'email', name: 'email', label: 'Email', required: true, auto: 'email' },
      { k: 'tel', name: 'phone', label: 'Phone', required: true, auto: 'tel' },
      { k: 'select', name: 'work_authorization', label: 'Visa / work status', options: VISA, required: true },
      { k: 'select', name: 'technology', label: 'Technology track', options: 'skills', required: true },
      { k: 'select', name: 'experience', label: 'IT experience', options: EXPERIENCE },
      { k: 'text', name: 'location', label: 'Current location', auto: 'address-level2' },
      { k: 'resume' },
      { k: 'textarea', name: 'message', label: 'Tell us about your goals' },
    ],
  },
  employer: {
    tab: "I'm hiring",
    submit: 'Send hiring request',
    consent: 'Your details are used only to reply to your request.',
    done: 'Thanks, we have your hiring request.',
    fields: [
      { k: 'choices', name: 'hire_type', legend: 'Type of hire', multi: true, options: ['Contract', 'Contract-to-hire', 'Direct hire', 'Project / team'] },
      { k: 'text', name: 'company', label: 'Company', required: true, auto: 'organization' },
      { k: 'text', name: 'name', label: 'Your name', required: true, auto: 'name' },
      { k: 'email', name: 'email', label: 'Work email', required: true, auto: 'email' },
      { k: 'tel', name: 'phone', label: 'Phone', auto: 'tel' },
      { k: 'text', name: 'role', label: 'Role(s) to fill', required: true, full: true },
      { k: 'text', name: 'skills', label: 'Key skills', full: true },
      { k: 'select', name: 'headcount', label: 'How many people', options: ['1', '2–5', '6–10', '10+'] },
      { k: 'select', name: 'start', label: 'Start', options: ['ASAP', 'Within 30 days', '1–3 months', 'Just planning'] },
      { k: 'textarea', name: 'message', label: 'Anything else we should know?' },
    ],
  },
  partner: {
    tab: "I'm a vendor or partner",
    submit: 'Send enquiry',
    consent: 'Your details are used only to reply to your enquiry.',
    done: 'Thanks, we have your enquiry.',
    fields: [
      { k: 'choices', name: 'partnership_type', legend: 'How would you like to work together?', multi: true, options: ['Subvendor / bench sharing', 'Prime vendor / requirements', 'Implementation partner'] },
      { k: 'text', name: 'company', label: 'Company', required: true, auto: 'organization' },
      { k: 'text', name: 'name', label: 'Your name', required: true, auto: 'name' },
      { k: 'email', name: 'email', label: 'Work email', required: true, auto: 'email' },
      { k: 'tel', name: 'phone', label: 'Phone', auto: 'tel' },
      { k: 'url', name: 'website', label: 'Company website' },
      { k: 'select', name: 'bench_size', label: 'Bench / team size', options: ['1–10', '11–50', '51–200', '200+', 'N/A'] },
      { k: 'text', name: 'core_skills', label: 'Core skills or open requirements', full: true },
      { k: 'textarea', name: 'message', label: 'Tell us more', required: true },
    ],
  },
  training: {
    tab: 'Training',
    submit: 'Send training enquiry',
    consent: 'By submitting, you agree that {company} may contact you about training.',
    done: 'Thanks, we have your training enquiry.',
    fields: [
      { k: 'choices', name: 'format', legend: 'Preferred format', options: ['Online, live', 'In class', 'Either'] },
      { k: 'text', name: 'name', label: 'Full name', required: true, auto: 'name' },
      { k: 'email', name: 'email', label: 'Email', required: true, auto: 'email' },
      { k: 'tel', name: 'phone', label: 'Phone', required: true, auto: 'tel' },
      { k: 'select', name: 'course', label: 'Course', options: 'courses', required: true },
      { k: 'select', name: 'work_authorization', label: 'Visa / work status', options: VISA },
      { k: 'select', name: 'start', label: 'When would you like to start?', options: ['Next batch', 'Within a month', 'Just exploring'] },
      { k: 'textarea', name: 'message', label: 'Questions about the course?' },
    ],
  },
};

export const GOAL_IDS = Object.keys(GOALS) as GoalId[];

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const e = (s: string) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

function fieldHtml(goal: GoalId, f: Field, opts: { skills: string[]; courses: string[] }): string {
  const id = (n: string) => `pp-${goal}-${n}`;
  switch (f.k) {
    case 'choices':
      return `<fieldset class="pp-choices pp-full"><legend>${e(f.legend)}</legend>${f.options.map((o, i) =>
        `<label><input type="${f.multi ? 'checkbox' : 'radio'}" name="${f.name}" value="${e(o)}"${i === 0 ? ' checked' : ''}><span>${e(o)}</span></label>`).join('')}</fieldset>`;
    case 'select': {
      const list = f.options === 'skills' ? opts.skills : f.options === 'courses' ? opts.courses : f.options;
      const withOther = f.options === 'skills' || f.options === 'courses' ? [...list, 'Other'] : list;
      return `<label class="pp-field${f.full ? ' pp-full' : ''}" for="${id(f.name)}"><span>${e(f.label)}${f.required ? ' *' : ''}</span><select id="${id(f.name)}" name="${f.name}"${f.required ? ' required' : ''}><option value="" selected disabled>Choose one</option>${withOther.map(o => `<option>${e(o)}</option>`).join('')}</select></label>`;
    }
    case 'textarea':
      return `<label class="pp-field pp-full" for="${id(f.name)}"><span>${e(f.label)}${f.required ? ' *' : ''}</span><textarea id="${id(f.name)}" name="${f.name}" rows="3"${f.required ? ' required' : ''}></textarea></label>`;
    case 'resume':
      return `<label class="pp-drop pp-full"><input type="file" name="resume" accept=".pdf,.doc,.docx"><b class="pp-drop-name">Upload your résumé</b><small>PDF or DOCX, up to 10 MB</small></label>`;
    default:
      return `<label class="pp-field${f.full ? ' pp-full' : ''}" for="${id(f.name)}"><span>${e(f.label)}${f.required ? ' *' : ''}</span><input id="${id(f.name)}" name="${f.name}" type="${f.k}"${f.auto ? ` autocomplete="${f.auto}"` : ''}${f.required ? ' required' : ''}></label>`;
  }
}

export type EnquireOptions = {
  goals: { id: GoalId; label?: string }[];
  company: string;
  eyebrow: string;
  title: string;
  text: string;
  contact: { email?: string; phone?: string; phone_digits?: string; address?: string };
  badges: string[];
  skills: string[];
  courses: string[];
};

export function enquireHtml(o: EnquireOptions): string {
  const goals = o.goals.filter(g => GOALS[g.id]);
  const tabs = goals.map((g, i) =>
    `<button type="button" role="tab" aria-selected="${i === 0}" data-tab="${g.id}">${e(g.label || GOALS[g.id].tab)}</button>`).join('');
  const forms = goals.map((g, i) => {
    const def = GOALS[g.id];
    return `<form class="pp-form" id="pp-form-${g.id}" data-type="${g.id}" data-done="${e(def.done)}"${i === 0 ? '' : ' hidden'} novalidate>
<input type="text" name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true" class="pp-hp">
<div class="pp-grid">${def.fields.map(f => fieldHtml(g.id, f, o)).join('')}</div>
<div class="pp-foot"><p>${e(def.consent.replace('{company}', o.company))}</p><button class="pp-btn" type="submit">${e(def.submit)}</button></div>
</form>`;
  }).join('\n');
  const contact = [
    o.contact.email ? `<li><a href="mailto:${e(o.contact.email)}">${e(o.contact.email)}</a></li>` : '',
    o.contact.phone ? `<li><a href="tel:${e(o.contact.phone_digits ?? '')}">${e(o.contact.phone)}</a></li>` : '',
    o.contact.address ? `<li>${e(o.contact.address)}</li>` : '',
  ].join('');
  return `<section id="enquire" class="pp-enq" aria-labelledby="pp-enq-title">
<div class="pp-enq-inner">
<div class="pp-enq-side">
<p class="pp-eyebrow">${e(o.eyebrow)}</p>
<h2 id="pp-enq-title" class="pp-enq-title">${e(o.title)}</h2>
<p class="pp-enq-text">${e(o.text)}</p>
${goals.length > 1 ? `<div class="pp-tabs" role="tablist" aria-label="Enquiry type">${tabs}</div>` : ''}
<ul class="pp-contact">${contact}</ul>
${o.badges.length ? `<div class="pp-badges">${o.badges.map(b => `<span class="pp-badge">${e(b)}</span>`).join('')}</div>` : ''}
</div>
<div class="pp-enq-forms">
${forms}
<div class="pp-success" id="pp-success" role="status" aria-live="polite" hidden>
<div class="pp-check" aria-hidden="true">✓</div>
<h3 id="pp-s-title">Thanks, we've received it.</h3>
<p id="pp-s-text">Someone from ${e(o.company)} will be in touch shortly.</p>
<button class="pp-btn pp-btn-ghost" type="button" id="pp-again">Send another</button>
</div>
</div>
</div>
</section>`;
}
