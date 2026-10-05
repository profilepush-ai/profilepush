// Website Modernization templates: content JSON in, a complete single-page
// site out. Used by the demo generator (admin-websites edge function) and by
// scripts/website-publish.mjs (Node runs this file directly).
//
// Content always comes from the firm's own website: the generator rewrites
// it, never invents it. Each template has its own design; only the enquiry
// forms (goals.ts) are shared.
//
// Template syntax:
//   {{a.b}}                   escaped value
//   {{{a.b}}}                 raw value (only values built here, never content)
//   {{#each a.b}}…{{/each}}   repeat; inside, {{.x}} is the item's field, {{.}} the item
//   {{#if a.b}}…{{/if}}       keep when truthy (non-empty)
// Blocks nest freely.

import { TEMPLATE_SOURCES, ENQUIRE_CSS, ENQUIRE_SCRIPT } from './templates.generated.ts';
import { enquireHtml, GOALS, type GoalId } from './goals.ts';

export type SiteGoal = {
  id: GoalId;
  audience: string;      // who it's for: "Consultants", "Employers"
  cta: string;           // button text: "Start my IT career"
  card_title: string;
  card_text: string;
  section_title: string;
  section_text: string;
  points: { title: string; text: string }[];
};

export type SiteContent = {
  company_name: string;
  legal_name?: string;
  logo_text?: string;
  // Colours and Google Fonts families taken from the firm's own site.
  theme?: { primary?: string; secondary?: string; font_display?: string; font_body?: string };
  seo?: { title?: string; description?: string };
  hero: { eyebrow: string; title: string; sub: string };
  goals: SiteGoal[];
  goals_title?: string;
  highlights?: { value: string; label: string }[];
  about?: { title?: string; text?: string };
  nav_services_label?: string;
  services_title: string;
  services_intro?: string;
  services: { title: string; text: string }[];
  industries_title?: string;
  industries?: { name: string; text?: string }[];
  process_title?: string;
  process?: { title: string; text: string }[];
  finale?: string;
  testimonials_title?: string;
  testimonials?: { quote: string; name: string; role?: string }[];
  faq?: { q: string; a: string }[];
  enquire?: { eyebrow?: string; title?: string; text?: string };
  skill_options?: string[];
  course_options?: string[];
  contact?: { email?: string; phone?: string; address?: string };
  badges?: string[];
  footer_blurb?: string;
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATE_SOURCES);

// ── Template engine ──────────────────────────────────────────────────────
type Node =
  | { t: 'text'; v: string }
  | { t: 'var'; path: string; raw: boolean }
  | { t: 'each' | 'if'; path: string; body: Node[] };

function parse(src: string): Node[] {
  const re = /\{\{\{([\w.]+)\}\}\}|\{\{#(each|if) ([\w.]+)\}\}|\{\{\/(each|if)\}\}|\{\{(\.|[\w.]+)\}\}/g;
  const root: Node[] = [];
  const stack: { kind: string; nodes: Node[] }[] = [{ kind: 'root', nodes: root }];
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.nodes.push({ t: 'text', v: src.slice(last, m.index) });
    last = re.lastIndex;
    if (m[1]) top.nodes.push({ t: 'var', path: m[1], raw: true });
    else if (m[2]) {
      const node: Node = { t: m[2] as 'each' | 'if', path: m[3], body: [] };
      top.nodes.push(node);
      stack.push({ kind: m[2], nodes: node.body });
    } else if (m[4]) {
      if (top.kind !== m[4]) throw new Error(`Template: unexpected {{/${m[4]}}}`);
      stack.pop();
    } else top.nodes.push({ t: 'var', path: m[5], raw: false });
  }
  if (stack.length !== 1) throw new Error('Template: unclosed block');
  if (last < src.length) root.push({ t: 'text', v: src.slice(last) });
  return root;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ESC[c]);
const truthy = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v);

function lookup(ctx: unknown, item: unknown, path: string): unknown {
  if (path === '.') return item;
  const [root, parts] = path.startsWith('.') ? [item, path.slice(1).split('.')] : [ctx, path.split('.')];
  return parts.reduce<unknown>((v, k) => (v != null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), root);
}

function run(nodes: Node[], ctx: unknown, item: unknown): string {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') out += n.v;
    else if (n.t === 'var') {
      const v = lookup(ctx, item, n.path);
      const s = v == null ? '' : String(v);
      out += n.raw ? s : escapeHtml(s);
    } else if (n.t === 'if') {
      if (truthy(lookup(ctx, item, n.path))) out += run(n.body, ctx, item);
    } else {
      const list = lookup(ctx, item, n.path);
      if (Array.isArray(list)) for (const it of list) out += run(n.body, ctx, it);
    }
  }
  return out;
}

// Each template's own pairing, used only when the firm's site has no
// Google Fonts of its own (plain Arial/Helvetica sites).
const DEFAULT_FONTS: Record<string, { display: string; body: string }> = {
  meridian: { display: 'Fraunces', body: 'Manrope' },
  atlas: { display: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans' },
  nova: { display: 'Syne', body: 'DM Sans' },
};
const FAMILY = /^[A-Za-z][A-Za-z0-9 ]{1,40}$/;

function fontsFor(template: string, theme: SiteContent['theme']) {
  const d = DEFAULT_FONTS[template] ?? DEFAULT_FONTS.nova;
  const body = theme?.font_body && FAMILY.test(theme.font_body) ? theme.font_body : d.body;
  const display = theme?.font_display && FAMILY.test(theme.font_display) ? theme.font_display : (theme?.font_body && FAMILY.test(theme.font_body) ? body : d.display);
  // 400 and 700 exist for nearly every family; asking for a weight a family
  // lacks makes Google Fonts reject the whole request.
  const fam = (f: string) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;700`;
  const href = `https://fonts.googleapis.com/css2?${[...new Set([display, body])].map(fam).join('&')}&display=swap`;
  return { display, body, href };
}

const parsed: Record<string, Node[]> = {};
function compiled(name: string): Node[] {
  if (!TEMPLATE_SOURCES[name]) throw new Error(`Unknown template: ${name}`);
  return (parsed[name] ??= parse(TEMPLATE_SOURCES[name]));
}

// ── Colours ──────────────────────────────────────────────────────────────
const HEX = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Text colour that reads on the given background.
const inkFor = (hex: string) => (luminance(hex) > 0.42 ? '#0e1116' : '#ffffff');

// The brand colour, lightened until it stands out on a near-black page
// (dark navy or forest green would otherwise disappear).
function glowFor(hex: string): string {
  let [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < 12 && luminance(`#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`) < 0.28; i++) {
    [r, g, b] = [r, g, b].map(v => v + (255 - v) * 0.15);
  }
  return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

// ── Content → template context ───────────────────────────────────────────
const clean = (s: unknown, max = 600) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = <T>(v: T[] | undefined, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);

export function prepare(c: SiteContent): Record<string, unknown> {
  const name = clean(c.company_name, 120);
  const primary = HEX.test(c.theme?.primary ?? '') ? c.theme!.primary! : '#1d4ed8';
  const secondary = HEX.test(c.theme?.secondary ?? '') ? c.theme!.secondary! : '#f59e0b';
  const goals = list(c.goals, 3).filter(g => GOALS[g.id]).map((g, i) => ({
    ...g,
    points: list(g.points, 5),
    first: i === 0,
    not_first: i !== 0,
    alt: i % 2 === 1,
  }));
  if (goals.length === 0) throw new Error('Content needs at least one goal.');
  const contact = {
    email: clean(c.contact?.email, 120),
    phone: clean(c.contact?.phone, 40),
    phone_digits: (c.contact?.phone ?? '').replace(/[^\d+]/g, ''),
    address: clean(c.contact?.address, 200),
  };
  const badges = list(c.badges, 4).map(b => clean(b, 40)).filter(Boolean);
  const skills = list(c.skill_options, 16).map(s => clean(s, 60)).filter(Boolean);
  const courses = list(c.course_options, 16).map(s => clean(s, 60)).filter(Boolean);

  return {
    ...c,
    company_name: name,
    legal_name: clean(c.legal_name, 120) || name,
    logo_text: clean(c.logo_text, 40) || name,
    theme: {
      primary, secondary, primary_ink: inkFor(primary), secondary_ink: inkFor(secondary),
      glow: glowFor(primary), glow2: glowFor(secondary), glow_ink: inkFor(glowFor(primary)),
    },
    seo: {
      title: clean(c.seo?.title, 70) || name,
      description: clean(c.seo?.description, 160) || clean(c.hero.sub, 160),
    },
    nav: { services: clean(c.nav_services_label, 24) || 'Services' },
    goals,
    goal_count: goals.length,
    primary_goal: goals[0],
    secondary_goal: goals[1] ?? null,
    goals_title: clean(c.goals_title, 80) || 'How we can work together.',
    highlights: list(c.highlights, 4),
    highlight_count: Math.max(1, list(c.highlights, 4).length),
    services: list(c.services, 9),
    industries: list(c.industries, 12),
    industries_title: clean(c.industries_title, 80) || 'Industries we serve.',
    process: list(c.process, 6),
    process_title: clean(c.process_title, 80) || 'How it works.',
    testimonials: list(c.testimonials, 6).map((t, i) => ({ ...t, first: i === 0 })),
    finale: clean(c.finale, 40) || "Let's talk.",
    // Words for Nova's kinetic banner: the firm's skills, else its services.
    ticker: (skills.length ? skills : list(c.services, 9).map(sv => clean(sv.title, 40))).slice(0, 12),
    testimonials_title: clean(c.testimonials_title, 80) || 'What people say.',
    faq: list(c.faq, 8).map((f, i) => ({ ...f, open: i === 0 })),
    footer_blurb: clean(c.footer_blurb, 240),
    enquire_css: ENQUIRE_CSS,
    enquire_script: ENQUIRE_SCRIPT,
    enquire_html: enquireHtml({
      goals: goals.map(g => ({ id: g.id, label: g.audience })),
      company: name,
      eyebrow: clean(c.enquire?.eyebrow, 40) || 'Get in touch',
      title: clean(c.enquire?.title, 80) || `Talk to ${name}.`,
      text: clean(c.enquire?.text, 300) || 'Choose what you need and we will get back to you.',
      contact,
      badges,
      skills: skills.length ? skills : ['Java', '.NET', 'Cloud / DevOps', 'Data', 'SAP', 'Salesforce', 'QA'],
      courses: courses.length ? courses : skills,
    }),
    // Read by the page's script. "<" is escaped so content can't close the tag.
    site_data_json: JSON.stringify({ company: name, email: contact.email }).replace(/</g, '\\u003c'),
  };
}

export function renderSite(template: string, content: SiteContent): string {
  return run(compiled(template), { ...prepare(content), fonts: fontsFor(template, content.theme) }, undefined);
}
