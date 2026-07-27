import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PenLine, Download, Sparkles, FileText,
  User, Briefcase, ChevronDown, Search, X, Save,
  RotateCcw, CheckCircle2, GraduationCap, Code2, Eye, Edit3,
  Zap, AlertCircle, Clock, ExternalLink, LayoutTemplate,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Profile, WishlistedJob, ResumeFile } from '../types/database';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ExperienceEntry {
  company: string; title: string; location: string;
  start_date: string; end_date: string; current: boolean; description: string;
}
interface EducationEntry {
  institution: string; degree: string; field: string;
  start_year: string; end_year: string; gpa?: string;
}
interface RewrittenField {
  summary: string; skills: string;
  experience: ExperienceEntry[]; education: EducationEntry[];
}
interface MatchScore {
  score: number; summary: string; strengths: string[]; gaps: string[];
  optimization_points: string[];
}

// idle → (job selected) → scoring → ready → rewriting → done
type RewriteState = 'idle' | 'scoring' | 'ready' | 'rewriting' | 'done';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseSkills(raw: string): string[] {
  if (!raw) return [];
  const lines = raw.split('\n').map(l => l.replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  return raw.split(',').map(s => s.replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean);
}

function parseBullets(raw: string): string[] {
  if (!raw) return [];
  const lines = raw.split('\n').map(l => l.replace(/^[•\-\*]\s*/, '').trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  const bySemi = raw.split(/\s*;\s*/).map(s => s.trim()).filter(s => s.length > 8);
  if (bySemi.length > 1) return bySemi;
  return raw.split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(s => s.length > 8);
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPromptText(profile: Profile, job: WishlistedJob, match?: MatchScore): string {
  const header = `Rewrite ${profile.candidate_name}'s resume for the ${job.job_title} role at ${job.company}.`;
  if (!match) {
    return `${header}\n\nTailor the summary, skills, and experience bullets to this role. Use strong action verbs, quantify outcomes, and include keywords from the job description.`;
  }
  const points = match.optimization_points.length >= 3
    ? match.optimization_points
    : [`Strengthen the professional summary to target ${job.job_title} directly.`, `Lead with the most relevant skills matching this role's requirements.`, `Rewrite experience bullets with quantified impact and action verbs.`];
  return `${header}

Match Score: ${match.score}/100 — ${match.summary}

Focus on these 3 improvements:
1. ${points[0]}
2. ${points[1]}
3. ${points[2]}

Keep all facts accurate. Maximize ATS relevance and recruiter impact.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Change items (computed diff between original profile + rewritten output)
// ─────────────────────────────────────────────────────────────────────────────

function buildChangeSummary(profile: Profile, rw: RewrittenField, job: WishlistedJob): string[] {
  // Point 1 — summary
  const p1 = rw.summary.trim()
    ? `Summary rewritten to directly target ${job.job_title} at ${job.company}, leading with the most relevant experience.`
    : `Resume repositioned for the ${job.job_title} role at ${job.company}.`;

  // Point 2 — skills
  const origSkills = parseSkills((profile as Profile & { core_skills?: string }).core_skills || '');
  const newSkills  = parseSkills(rw.skills);
  const origSet    = new Set(origSkills.map(s => s.toLowerCase().trim()));
  const added      = newSkills.filter(s => !origSet.has(s.toLowerCase().trim()));
  const p2 = added.length > 0
    ? `${added.length} keyword${added.length > 1 ? 's' : ''} added (${added.slice(0, 3).join(', ')}${added.length > 3 ? '…' : ''}) and skills reordered for ATS relevance.`
    : 'Skills section reordered to surface the most relevant technologies for this role first.';

  // Point 3 — experience
  const expCount = rw.experience.length;
  const p3 = expCount > 0
    ? `Bullet points across ${expCount} role${expCount > 1 ? 's' : ''} rewritten with strong action verbs and quantified impact.`
    : 'Experience section rewritten with action-driven language matching the job description.';

  return [p1, p2, p3];
}


// ─────────────────────────────────────────────────────────────────────────────
// Resume templates
// ─────────────────────────────────────────────────────────────────────────────

interface ResumeTemplate { id: string; name: string; css: string; }

const RESUME_TEMPLATES: ResumeTemplate[] = [
  {
    id: 'classic',
    name: 'Classic',
    css: `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#d8d8d8;font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;color:#111;line-height:1.45;overflow-x:hidden}
.page{width:100%;background:#fff;margin:0 auto 16px;padding:18mm 20mm;box-shadow:0 2px 12px rgba(0,0,0,.2)}
.header{text-align:center;border-bottom:1.75px solid #111;padding-bottom:10px;margin-bottom:16px}
.header h1{font-size:18pt;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px}
.contact{font-size:9pt;color:#444;display:flex;justify-content:center;flex-wrap:wrap;gap:0 6px}
.contact span+span::before{content:"·";margin-right:6px;color:#999}
.section{margin-bottom:14px}
.sec-title{font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #111;padding-bottom:2px;margin-bottom:7px}
.body-text{font-size:10pt;line-height:1.55;color:#222}
.skills-text{font-size:10pt;line-height:1.6;color:#222}
.exp-item{margin-bottom:11px}
.exp-top{display:flex;justify-content:space-between;align-items:baseline}
.exp-company{font-weight:700;font-size:10.5pt}
.exp-loc{font-size:9.5pt;color:#555}
.exp-mid{display:flex;justify-content:space-between;align-items:baseline;margin-top:1px}
.exp-title{font-style:italic;font-size:10pt;color:#333}
.exp-dates{font-size:9.5pt;color:#666}
.exp-desc{font-size:10pt;margin-top:4px;color:#222;line-height:1.5}
ul{margin:5px 0 0 16px;padding:0}
li{margin-bottom:2.5px;font-size:10pt;color:#222;line-height:1.45}
.edu-item{margin-bottom:9px}
.edu-top{display:flex;justify-content:space-between;align-items:baseline}
.edu-degree{font-weight:700;font-size:10.5pt}
.edu-year{font-size:9.5pt;color:#666}
.edu-school{font-size:10pt;color:#555;margin-top:2px}
@media print{
  html,body{background:#fff}
  .page{width:100%;margin:0;padding:0;box-shadow:none}
  .exp-item,.edu-item{break-inside:avoid}
  @page{size:A4;margin:18mm 20mm}
  @page{@top-left{content:''}@top-center{content:''}@top-right{content:''}@bottom-left{content:''}@bottom-center{content:''}@bottom-right{content:''}}
}`,
  },
  {
    id: 'modern',
    name: 'Modern',
    css: `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#e2e8f0;font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;color:#1e293b;line-height:1.45;overflow-x:hidden}
.page{width:100%;background:#fff;margin:0 auto 16px;padding:18mm 20mm;box-shadow:0 4px 16px rgba(0,0,0,.15)}
.header{text-align:center;padding-bottom:12px;margin-bottom:16px;border-bottom:2.5px solid #2563eb}
.header h1{font-size:18pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px;color:#1e293b}
.contact{font-size:9pt;color:#64748b;display:flex;justify-content:center;flex-wrap:wrap;gap:0 8px}
.contact span+span::before{content:"·";margin-right:8px;color:#94a3b8}
.section{margin-bottom:14px}
.sec-title{font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#2563eb;border-bottom:1.5px solid #bfdbfe;padding-bottom:3px;margin-bottom:8px}
.body-text{font-size:10pt;line-height:1.55;color:#334155}
.skills-text{font-size:10pt;line-height:1.6;color:#334155}
.exp-item{margin-bottom:11px}
.exp-top{display:flex;justify-content:space-between;align-items:baseline}
.exp-company{font-weight:700;font-size:10.5pt;color:#1e293b}
.exp-loc{font-size:9.5pt;color:#64748b}
.exp-mid{display:flex;justify-content:space-between;align-items:baseline;margin-top:2px}
.exp-title{font-style:italic;font-size:10pt;color:#475569}
.exp-dates{font-size:9pt;color:#2563eb}
.exp-desc{font-size:10pt;margin-top:4px;color:#334155;line-height:1.5}
ul{margin:5px 0 0 16px;padding:0}
li{margin-bottom:3px;font-size:10pt;color:#334155;line-height:1.45}
.edu-item{margin-bottom:9px}
.edu-top{display:flex;justify-content:space-between;align-items:baseline}
.edu-degree{font-weight:700;font-size:10.5pt;color:#1e293b}
.edu-year{font-size:9pt;color:#2563eb}
.edu-school{font-size:10pt;color:#64748b;margin-top:2px}
@media print{
  html,body{background:#fff}
  .page{width:100%;margin:0;padding:0;box-shadow:none}
  .exp-item,.edu-item{break-inside:avoid}
  @page{size:A4;margin:18mm 20mm}
  @page{@top-left{content:''}@top-center{content:''}@top-right{content:''}@bottom-left{content:''}@bottom-center{content:''}@bottom-right{content:''}}
}`,
  },
  {
    id: 'executive',
    name: 'Executive',
    css: `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;color:#111;line-height:1.45;overflow-x:hidden}
.page{width:100%;background:#fff;margin:0 auto 16px;padding:18mm 20mm;box-shadow:0 4px 20px rgba(0,0,0,.18)}
.header{border-top:5px solid #0f172a;padding-top:14px;text-align:center;padding-bottom:12px;margin-bottom:18px;border-bottom:1px solid #cbd5e1}
.header h1{font-size:19pt;font-weight:700;text-transform:uppercase;letter-spacing:.15em;margin-bottom:6px;color:#0f172a}
.contact{font-size:9pt;color:#475569;display:flex;justify-content:center;flex-wrap:wrap;gap:0 8px}
.contact span+span::before{content:"·";margin-right:8px;color:#94a3b8}
.section{margin-bottom:15px}
.sec-title{font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#0f172a;background:#f8fafc;padding:3px 8px;border-left:3px solid #0f172a;margin-bottom:9px}
.body-text{font-size:10pt;line-height:1.55;color:#1e293b}
.skills-text{font-size:10pt;line-height:1.6;color:#1e293b}
.exp-item{margin-bottom:12px}
.exp-top{display:flex;justify-content:space-between;align-items:baseline}
.exp-company{font-weight:700;font-size:11pt;color:#0f172a}
.exp-loc{font-size:9.5pt;color:#64748b}
.exp-mid{display:flex;justify-content:space-between;align-items:baseline;margin-top:2px}
.exp-title{font-style:italic;font-size:10pt;color:#374151}
.exp-dates{font-size:9pt;color:#475569;font-weight:600}
.exp-desc{font-size:10pt;margin-top:4px;color:#1e293b;line-height:1.5}
ul{margin:5px 0 0 16px;padding:0}
li{margin-bottom:3px;font-size:10pt;color:#1e293b;line-height:1.45}
.edu-item{margin-bottom:10px}
.edu-top{display:flex;justify-content:space-between;align-items:baseline}
.edu-degree{font-weight:700;font-size:11pt;color:#0f172a}
.edu-year{font-size:9pt;color:#475569;font-weight:600}
.edu-school{font-size:10pt;color:#64748b;margin-top:2px}
@media print{
  html,body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:100%;margin:0;padding:0;box-shadow:none;border-top:none}
  .exp-item,.edu-item{break-inside:avoid}
  @page{size:A4;margin:18mm 20mm}
  @page{@top-left{content:''}@top-center{content:''}@top-right{content:''}@bottom-left{content:''}@bottom-center{content:''}@bottom-right{content:''}}
}`,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    css: `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;color:#374151;line-height:1.6;overflow-x:hidden}
.page{width:100%;background:#fff;margin:0 auto 16px;padding:20mm 22mm;box-shadow:0 1px 8px rgba(0,0,0,.1)}
.header{text-align:center;padding-bottom:14px;margin-bottom:18px;border-bottom:1px solid #e5e7eb}
.header h1{font-size:17pt;font-weight:700;text-transform:uppercase;letter-spacing:.2em;margin-bottom:7px;color:#111827}
.contact{font-size:9pt;color:#6b7280;display:flex;justify-content:center;flex-wrap:wrap;gap:0 10px}
.contact span+span::before{content:"·";margin-right:10px;color:#d1d5db}
.section{margin-bottom:16px}
.sec-title{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.15em;color:#9ca3af;margin-bottom:8px}
.body-text{font-size:10pt;line-height:1.6;color:#374151}
.skills-text{font-size:10pt;line-height:1.7;color:#374151}
.exp-item{margin-bottom:13px;padding-left:12px;border-left:2px solid #f3f4f6}
.exp-top{display:flex;justify-content:space-between;align-items:baseline}
.exp-company{font-weight:700;font-size:10.5pt;color:#111827}
.exp-loc{font-size:9pt;color:#9ca3af}
.exp-mid{display:flex;justify-content:space-between;align-items:baseline;margin-top:2px}
.exp-title{font-style:italic;font-size:10pt;color:#6b7280}
.exp-dates{font-size:9pt;color:#9ca3af}
.exp-desc{font-size:10pt;margin-top:5px;color:#374151;line-height:1.55}
ul{margin:5px 0 0 0;padding:0;list-style:none}
li{margin-bottom:3px;font-size:10pt;color:#374151;line-height:1.5;padding-left:12px;position:relative}
li::before{content:"–";position:absolute;left:0;color:#d1d5db}
.edu-item{margin-bottom:10px}
.edu-top{display:flex;justify-content:space-between;align-items:baseline}
.edu-degree{font-weight:700;font-size:10.5pt;color:#111827}
.edu-year{font-size:9pt;color:#9ca3af}
.edu-school{font-size:10pt;color:#6b7280;margin-top:2px}
@media print{
  html,body{background:#fff}
  .page{width:100%;margin:0;padding:0;box-shadow:none}
  .exp-item{border-left:none;padding-left:0}
  .exp-item,.edu-item{break-inside:avoid}
  @page{size:A4;margin:20mm 22mm}
  @page{@top-left{content:''}@top-center{content:''}@top-right{content:''}@bottom-left{content:''}@bottom-center{content:''}@bottom-right{content:''}}
}`,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Resume HTML builder (A4 preview + print)
// ─────────────────────────────────────────────────────────────────────────────

function buildResumeHtml(profile: Profile, rw: RewrittenField, templateId = 'classic'): string {
  const locParts = [profile.city, profile.state, profile.country].filter(Boolean);
  const location = locParts.length ? locParts.join(', ') : profile.location || '';
  const contactParts = [profile.email, profile.phone, location, profile.linkedin_url].filter(Boolean) as string[];
  const skills = parseSkills(rw.skills);

  const expHtml = rw.experience.map(exp => {
    const bullets = parseBullets(exp.description);
    const bulletsHtml = bullets.length
      ? `<ul>${bullets.map(b => `<li>${escHtml(b)}</li>`).join('')}</ul>`
      : exp.description ? `<p class="exp-desc">${escHtml(exp.description)}</p>` : '';
    return `<div class="exp-item">
      <div class="exp-top"><span class="exp-company">${escHtml(exp.company)}</span><span class="exp-loc">${escHtml(exp.location || '')}</span></div>
      <div class="exp-mid"><span class="exp-title">${escHtml(exp.title)}</span><span class="exp-dates">${escHtml(exp.start_date)} &ndash; ${exp.current ? 'Present' : escHtml(exp.end_date)}</span></div>
      ${bulletsHtml}</div>`;
  }).join('');

  const eduHtml = rw.education.map(edu => `
    <div class="edu-item">
      <div class="edu-top"><span class="edu-degree">${escHtml(edu.degree)} in ${escHtml(edu.field)}</span><span class="edu-year">${escHtml(edu.start_year)} &ndash; ${escHtml(edu.end_year)}</span></div>
      <div class="edu-school">${escHtml(edu.institution)}${edu.gpa ? ` &middot; GPA: ${escHtml(edu.gpa)}` : ''}</div>
    </div>`).join('');

  const sections = [
    rw.summary.trim() ? `<div class="section"><div class="sec-title">Professional Summary</div><p class="body-text">${escHtml(rw.summary.trim())}</p></div>` : '',
    skills.length ? `<div class="section"><div class="sec-title">Technical Skills</div><p class="skills-text">${skills.map(escHtml).join(' &middot; ')}</p></div>` : '',
    rw.experience.length ? `<div class="section"><div class="sec-title">Professional Experience</div>${expHtml}</div>` : '',
    rw.education.length ? `<div class="section"><div class="sec-title">Education</div>${eduHtml}</div>` : '',
    profile.visa_status ? `<div class="section"><div class="sec-title">Work Authorization</div><p class="body-text">${escHtml(profile.visa_status)}</p></div>` : '',
  ].filter(Boolean).join('');

  const templateCss = (RESUME_TEMPLATES.find(t => t.id === templateId) ?? RESUME_TEMPLATES[0]).css;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title></title>
<style>${templateCss}</style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1>${escHtml(profile.candidate_name)}</h1>
    <div class="contact">${contactParts.map(p => `<span>${escHtml(p)}</span>`).join('')}</div>
  </div>
  ${sections}
</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF builder (jsPDF — generates a real, searchable A4 PDF)
// ─────────────────────────────────────────────────────────────────────────────

async function buildResumePdf(profile: Profile, rw: RewrittenField): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();   // 595.28pt
  const PH = doc.internal.pageSize.getHeight();  // 841.89pt
  const ML = 72, MR = 72, MT = 72, MB = 72;
  const CW = PW - ML - MR;
  // Start y so the TOP of the first letter sits at MT from the page edge.
  // jsPDF places text by baseline; cap-height of 18pt Helvetica ≈ 13pt.
  let y = MT + 13;

  const skills = parseSkills(rw.skills);
  const locParts = [profile.city, profile.state, profile.country].filter(Boolean);
  const location = locParts.length ? locParts.join(', ') : profile.location || '';
  const contactParts = [profile.email, profile.phone, location].filter(Boolean) as string[];

  // Ensure we don't overflow the page; add a new page if needed.
  // Use MT + 10 on new pages so text top aligns visually with page 1.
  function checkY(needed: number) {
    if (y + needed > PH - MB) { doc.addPage(); y = MT + 10; }
  }

  // Section header with underline rule
  function sectionHeader(title: string) {
    checkY(20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(17, 17, 17);
    doc.text(title.toUpperCase(), ML, y);
    y += 3;
    doc.setDrawColor(17, 17, 17);
    doc.setLineWidth(0.75);
    doc.line(ML, y, PW - MR, y);
    y += 9;
  }

  // Wrapped text block — returns new y
  function textBlock(text: string, x: number, maxWidth: number, fontSize: number, fontStyle: 'normal' | 'bold' | 'italic', color = 34) {
    doc.setFont('helvetica', fontStyle);
    doc.setFontSize(fontSize);
    doc.setTextColor(color, color, color);
    const lines = doc.splitTextToSize(text, maxWidth);
    const lineH = fontSize * 1.35;
    checkY(lines.length * lineH);
    doc.text(lines, x, y);
    y += lines.length * lineH;
  }

  // ── Header ──────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(17, 17, 17);
  doc.text(profile.candidate_name.toUpperCase(), PW / 2, y, { align: 'center' });
  y += 20;

  if (contactParts.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text(contactParts.join('  ·  '), PW / 2, y, { align: 'center' });
    y += 8;
  }
  if (profile.linkedin_url) {
    doc.setFontSize(9);
    doc.text(profile.linkedin_url, PW / 2, y, { align: 'center' });
    y += 8;
  }

  // Horizontal rule under header
  doc.setDrawColor(17, 17, 17);
  doc.setLineWidth(1.25);
  doc.line(ML, y, PW - MR, y);
  y += 14;

  // ── Professional Summary ────────────────────────────────────────────────────
  if (rw.summary.trim()) {
    sectionHeader('Professional Summary');
    textBlock(rw.summary.trim(), ML, CW, 10, 'normal');
    y += 8;
  }

  // ── Technical Skills ────────────────────────────────────────────────────────
  if (skills.length) {
    sectionHeader('Technical Skills');
    textBlock(skills.join('  ·  '), ML, CW, 10, 'normal');
    y += 8;
  }

  // ── Professional Experience ─────────────────────────────────────────────────
  if (rw.experience.length) {
    sectionHeader('Professional Experience');
    for (const exp of rw.experience) {
      checkY(40);
      const dates = `${exp.start_date} – ${exp.current ? 'Present' : exp.end_date}`;

      // Company + dates row
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(17, 17, 17);
      doc.text(exp.company, ML, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(80, 80, 80);
      doc.text(dates, PW - MR, y, { align: 'right' });
      y += 14;

      // Title + location row
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
      doc.text(exp.title, ML, y);
      if (exp.location) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(100, 100, 100);
        doc.text(exp.location, PW - MR, y, { align: 'right' });
      }
      y += 12;

      // Bullet points
      const bullets = parseBullets(exp.description);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(34, 34, 34);
      for (const bullet of bullets) {
        const wrapped = doc.splitTextToSize(bullet, CW - 14);
        const lineH = 10 * 1.4;
        checkY(wrapped.length * lineH + 2);
        doc.text('•', ML, y);
        doc.text(wrapped, ML + 12, y);
        y += wrapped.length * lineH + 1;
      }
      if (!bullets.length && exp.description) {
        textBlock(exp.description, ML, CW, 10, 'normal');
      }
      y += 7;
    }
  }

  // ── Education ───────────────────────────────────────────────────────────────
  if (rw.education.length) {
    sectionHeader('Education');
    for (const edu of rw.education) {
      checkY(28);
      const yearRange = `${edu.start_year} – ${edu.end_year}`;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(17, 17, 17);
      doc.text(`${edu.degree} in ${edu.field}`, ML, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(80, 80, 80);
      doc.text(yearRange, PW - MR, y, { align: 'right' });
      y += 13;
      doc.setFontSize(10);
      doc.setTextColor(80, 80, 80);
      doc.text(edu.institution + (edu.gpa ? `  ·  GPA: ${edu.gpa}` : ''), ML, y);
      y += 14;
    }
  }

  // ── Work Authorization ──────────────────────────────────────────────────────
  if (profile.visa_status) {
    sectionHeader('Work Authorization');
    textBlock(profile.visa_status, ML, CW, 10, 'normal');
  }

  return doc.output('blob');
}

// ─────────────────────────────────────────────────────────────────────────────
// Resume preview iframe
// ─────────────────────────────────────────────────────────────────────────────

function ResumePreviewFrame({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(800);

  function handleLoad() {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // Use a short delay so mm-based layout has time to settle
    setTimeout(() => {
      const doc = iframe.contentDocument;
      if (doc) {
        const h = Math.max(600, doc.documentElement.scrollHeight, doc.body.scrollHeight);
        setHeight(h + 24);
      }
    }, 150);
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={html}
      onLoad={handleLoad}
      style={{ width: '100%', height: `${height}px`, border: 'none', display: 'block' }}
      title="Rewritten Resume Preview"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Resume editor
// ─────────────────────────────────────────────────────────────────────────────

function ResumeEditor({ rw, onChange }: { rw: RewrittenField; onChange: (rw: RewrittenField) => void }) {
  return (
    <div className="px-4 py-4 space-y-5">
      <FieldBlock label="Professional Summary">
        <textarea value={rw.summary} onChange={e => onChange({ ...rw, summary: e.target.value })} rows={4}
          className="w-full text-xs font-sans text-gray-800 leading-relaxed border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 resize-none" />
      </FieldBlock>
      <FieldBlock label="Technical Skills" hint="One per line or comma-separated">
        <textarea value={rw.skills} onChange={e => onChange({ ...rw, skills: e.target.value })} rows={4}
          className="w-full text-xs font-sans text-gray-800 leading-relaxed border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 resize-none" />
      </FieldBlock>
      {rw.experience.map((exp, i) => (
        <FieldBlock key={i} label={`${exp.title} at ${exp.company}`} hint={`${exp.start_date} – ${exp.current ? 'Present' : exp.end_date}`}>
          <textarea value={exp.description} rows={5} placeholder="Bullet points (one per line) or paragraph"
            onChange={e => onChange({ ...rw, experience: rw.experience.map((ex, j) => j === i ? { ...ex, description: e.target.value } : ex) })}
            className="w-full text-xs font-sans text-gray-800 leading-relaxed border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 resize-none" />
        </FieldBlock>
      ))}
      {rw.education.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Education</p>
          {rw.education.map((edu, i) => (
            <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 mb-2 text-xs text-gray-600">
              <p className="font-semibold text-gray-800">{edu.degree} in {edu.field}</p>
              <p>{edu.institution} · {edu.start_year}–{edu.end_year}{edu.gpa ? ` · GPA: ${edu.gpa}` : ''}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldBlock({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-600">{label}</p>
        {hint && <span className="text-[9px] text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate popup
// ─────────────────────────────────────────────────────────────────────────────

function CandidatePopup({ profiles, loading, query, onQuery, onSelect, onClose }: {
  profiles: Profile[]; loading: boolean; query: string;
  onQuery: (q: string) => void; onSelect: (p: Profile) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const filtered = profiles.filter(p =>
    p.candidate_name.toLowerCase().includes(query.toLowerCase()) ||
    (p.target_role ?? '').toLowerCase().includes(query.toLowerCase())
  );
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <Search size={14} className="text-gray-400 shrink-0" />
          <input ref={ref} value={query} onChange={e => onQuery(e.target.value)} placeholder="Search candidates…" className="flex-1 text-sm text-gray-900 outline-none placeholder-gray-400" />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading ? <div className="flex justify-center py-8"><LogoSpinner size={16} /></div>
            : filtered.map(p => (
              <button key={p.id} onClick={() => onSelect(p)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 shrink-0">{p.candidate_name[0]?.toUpperCase()}</div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{p.candidate_name}</p>
                  <p className="text-xs text-gray-400 truncate">{p.target_role || 'No target role'}</p>
                </div>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Job popup
// ─────────────────────────────────────────────────────────────────────────────

const BOARD_COLORS: Record<string, string> = {
  LinkedIn: 'bg-blue-50 text-blue-700', Dice: 'bg-orange-50 text-orange-700',
  Indeed: 'bg-violet-50 text-violet-700', Monster: 'bg-green-50 text-green-700',
  CareerBuilder: 'bg-emerald-50 text-emerald-700',
};

function JobPopup({ jobs, loading, query, onQuery, onSelect, onClose }: {
  jobs: WishlistedJob[]; loading: boolean; query: string;
  onQuery: (q: string) => void; onSelect: (j: WishlistedJob) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const filtered = jobs.filter(j =>
    j.job_title.toLowerCase().includes(query.toLowerCase()) ||
    j.company.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <Search size={14} className="text-gray-400 shrink-0" />
          <input ref={ref} value={query} onChange={e => onQuery(e.target.value)} placeholder="Search saved jobs…" className="flex-1 text-sm text-gray-900 outline-none placeholder-gray-400" />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading ? <div className="flex justify-center py-8"><LogoSpinner size={16} /></div>
            : filtered.length === 0 ? <div className="px-4 py-8 text-center text-xs text-gray-400">No saved jobs for this candidate</div>
            : filtered.map(j => (
              <button key={j.id} onClick={() => onSelect(j)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0">
                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0"><Briefcase size={13} className="text-gray-500" /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 truncate">{j.job_title}</p>
                  <p className="text-xs text-gray-400 truncate">{j.company}{j.location ? ` · ${j.location}` : ''}</p>
                </div>
                {j.board && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${BOARD_COLORS[j.board] ?? 'bg-gray-50 text-gray-600'}`}>{j.board}</span>}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Original resume col (col 1)
// ─────────────────────────────────────────────────────────────────────────────

function OriginalResumeCol({ file }: { file: ResumeFile | null }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const fileName = file?.file_name?.toLowerCase() ?? '';
  const fileUrl = file?.file_url ?? '';
  const isPdf = !!(fileName.endsWith('.pdf') || fileUrl.toLowerCase().match(/\.pdf(\?|$)/));
  const isDocx = !!(fileName.endsWith('.docx') || fileName.endsWith('.doc') || fileUrl.toLowerCase().match(/\.docx?(\?|$)/));

  useEffect(() => {
    if (!file?.file_url || isPdf || isDocx) { setText(''); return; }
    setLoading(true);
    fetch(file.file_url).then(r => r.text()).then(setText).catch(() => setText('Could not load file.')).finally(() => setLoading(false));
  }, [file?.file_url, isPdf, isDocx]);

  if (!file) return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
      <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center"><FileText size={20} className="text-gray-400" /></div>
      <p className="text-sm font-semibold text-gray-600">No resume files</p>
      <p className="text-xs text-gray-400">Upload a resume to the candidate profile first</p>
    </div>
  );

  if (isPdf && fileUrl) {
    return <div className="h-full overflow-hidden"><iframe src={`${fileUrl}#toolbar=0`} className="w-full h-full border-0" title="Original" /></div>;
  }

  if (isDocx && fileUrl) {
    const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
    return (
      <div className="h-full overflow-hidden">
        <iframe src={viewerUrl} className="w-full h-full border-0" title="Original" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      {loading
        ? <div className="flex justify-center items-center h-full"><LogoSpinner size={16} /></div>
        : <pre className="h-full overflow-y-auto px-4 py-3 text-xs text-gray-700 leading-relaxed whitespace-pre-wrap font-mono bg-white">{text || 'No content.'}</pre>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rewriting animation (col 2 during rewrite)
// ─────────────────────────────────────────────────────────────────────────────

function RewritingAnimation({ job }: { job: WishlistedJob | null }) {
  const [visible, setVisible] = useState(0);
  const insights = [
    'Scanning experience and skills against the job description for keyword alignment.',
    'Rewriting bullet points with action verbs and quantified impact statements.',
    'Optimizing ATS keyword density and professional summary for this specific role.',
  ];
  useEffect(() => {
    setVisible(0);
    const id = setInterval(() => setVisible(v => Math.min(v + 1, insights.length - 1)), 2400);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex flex-col h-full items-center justify-center px-8 bg-white">
      <div className="w-full max-w-[260px]">
        <div className="flex justify-center gap-1.5 mb-5">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: `${i * .15}s` }} />
          ))}
        </div>
        <p className="text-center text-xs font-bold text-gray-800 mb-0.5">Rewriting for {job?.job_title ?? 'role'}</p>
        <p className="text-center text-[10px] text-gray-400 mb-6">{job?.company ?? ''}</p>
        <div className="space-y-4">
          {insights.map((text, i) => (
            <div key={i}
              className={`flex items-start gap-3 transition-all duration-500 ${i <= visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
            >
              <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black leading-none mt-0.5 transition-colors duration-300
                ${i < visible ? 'bg-emerald-100 text-emerald-700' : i === visible ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'}`}>
                {i + 1}
              </span>
              <p className="text-xs text-gray-600 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ResumeAIPage() {
  const [searchParams] = useSearchParams();
  const { account } = useAuth();
  const [showCandidatePopup, setShowCandidatePopup] = useState(false);
  const [candidateQuery, setCandidateQuery]         = useState('');
  const [allProfiles, setAllProfiles]               = useState<Profile[]>([]);
  const [loadingProfiles, setLoadingProfiles]       = useState(false);
  const [selectedProfile, setSelectedProfile]       = useState<Profile | null>(null);

  // Job
  const [showJobPopup, setShowJobPopup] = useState(false);
  const [jobQuery, setJobQuery]         = useState('');
  const [savedJobs, setSavedJobs]       = useState<WishlistedJob[]>([]);
  const [loadingJobs, setLoadingJobs]   = useState(false);
  const [selectedJob, setSelectedJob]   = useState<WishlistedJob | null>(null);

  // State machine
  const [rewriteState, setRewriteState] = useState<RewriteState>('idle');
  const [matchScore, setMatchScore]     = useState<MatchScore | null>(null);
  const [prompt, setPrompt]             = useState('');
  const [jobDesc, setJobDesc]           = useState('');

  // Rewrite result
  const [rewritten, setRewritten]       = useState<RewrittenField>({ summary: '', skills: '', experience: [], education: [] });
  const [changeItems, setChangeItems]   = useState<string[]>([]);
  const [col2Mode, setCol2Mode]         = useState<'preview' | 'edit'>('preview');
  const [resumeHtml, setResumeHtml]     = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('classic');
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  // Original files
  const [originalFiles, setOriginalFiles] = useState<ResumeFile[]>([]);
  const [selectedOriginalFile, setSelectedOriginalFile] = useState<ResumeFile | null>(null);
  const [showFileDropdown, setShowFileDropdown] = useState(false);

  // Save
  const [savingToProfile, setSavingToProfile] = useState(false);
  const [savedToProfile, setSavedToProfile]   = useState(false);

  // History
  const [showHistory, setShowHistory]               = useState(false);
  const [historyFiles, setHistoryFiles]             = useState<ResumeFile[]>([]);
  const [loadingHistory, setLoadingHistory]         = useState(false);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (msg: string, type: 'success' | 'error') => setToast({ message: msg, type });

  // Custom JD mode (paste job description instead of selecting from saved jobs)
  const [customJdMode, setCustomJdMode] = useState(false);
  const [customJdText, setCustomJdText] = useState('');
  const [customJobTitle, setCustomJobTitle] = useState('');
  const [customJobCompany, setCustomJobCompany] = useState('');

  // ── Init ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadProfiles();
    const pid = searchParams.get('profileId');
    const jid = searchParams.get('jobId');
    if (pid) loadByParams(pid, jid ?? undefined);
  }, []);

  async function loadProfiles() {
    setLoadingProfiles(true);
    const { data } = await supabase.from('profiles').select('*').order('updated_at', { ascending: false });
    if (data) {
      setAllProfiles(data as Profile[]);
      const pid = searchParams.get('profileId');
      if (!pid && data.length > 0) selectProfile(data[0] as Profile);
    }
    setLoadingProfiles(false);
  }

  async function loadByParams(profileId: string, jobId?: string) {
    const { data: p } = await supabase.from('profiles').select('*').eq('id', profileId).maybeSingle();
    if (!p) return;
    await selectProfile(p as Profile);
    if (jobId) {
      const { data: j } = await supabase.from('wishlisted_jobs').select('*').eq('id', jobId).maybeSingle();
      if (j) await selectJob(j as WishlistedJob);
    }
  }

  // ── Select profile ────────────────────────────────────────────────────────

  async function selectProfile(p: Profile) {
    setSelectedProfile(p);
    setSelectedJob(null);
    setRewriteState('idle');
    setMatchScore(null);
    setPrompt('');
    setJobDesc('');
    setSavedToProfile(false);
    setCustomJdMode(false);
    setCustomJdText('');
    setCustomJobTitle('');
    setCustomJobCompany('');
    setRewritten({ summary: '', skills: p.core_skills || '', experience: Array.isArray(p.experience) ? [...p.experience] : [], education: Array.isArray(p.education) ? [...p.education] : [] });

    setLoadingJobs(true);
    const { data: jobs } = await supabase.from('wishlisted_jobs').select('*').eq('profile_id', p.id).order('created_at', { ascending: false });
    if (jobs) setSavedJobs(jobs as WishlistedJob[]);
    setLoadingJobs(false);

    const { data: files } = await supabase.from('resume_files').select('*').eq('profile_id', p.id).eq('category', 'resume').order('created_at', { ascending: true });
    if (files) {
      setOriginalFiles(files as ResumeFile[]);
      setSelectedOriginalFile((files as ResumeFile[])[0] ?? null);
    }
  }

  // ── Select job → go to idle (user triggers scoring manually) ────────────────

  const selectJob = useCallback(async (j: WishlistedJob) => {
    setSelectedJob(j);
    setRewriteState('idle');
    setMatchScore(null);
    setPrompt('');
    setJobDesc('');
    setSavedToProfile(false);

    // Fetch job description from source table
    const tableMap: Record<string, string> = { LinkedIn: 'linkedin_jobs', Dice: 'dice_jobs', Indeed: 'indeed_jobs', Monster: 'monster_jobs', CareerBuilder: 'careerbuilder_jobs' };
    let desc = '';
    if (j.source_job_id && j.board && tableMap[j.board]) {
      const { data } = await supabase.from(tableMap[j.board]).select('job_description').eq('id', j.source_job_id).maybeSingle();
      if (data?.job_description) desc = data.job_description as string;
    }
    if (!desc) desc = `${j.job_title} at ${j.company}${j.location ? ` (${j.location})` : ''}`;
    setJobDesc(desc);
  }, []);

  // ── Custom JD: build prompt + insert wishlisted_job entry ────────────────

  function buildCustomPromptText(profile: Profile, title: string, company: string, jd: string): string {
    const snippet = jd.length > 900 ? jd.slice(0, 900) + '…' : jd;
    return `Rewrite ${profile.candidate_name}'s resume for the ${title || 'open'} role at ${company || 'this company'}.

Job Description (provided by recruiter):
${snippet}

Tailor the summary, skills, and experience bullets to match this role. Use strong action verbs, quantify outcomes, and include keywords from the job description.`;
  }

  async function startCustomJdRewrite() {
    if (!selectedProfile || !customJobTitle.trim() || !customJdText.trim()) return;
    setRewriteState('scoring');

    const { data: newJob, error } = await supabase
      .from('wishlisted_jobs')
      .insert({
        profile_id: selectedProfile.id,
        job_title: customJobTitle.trim(),
        company: customJobCompany.trim() || 'Client',
        board: 'Custom',
        status: 'saved',
        location: '',
      })
      .select()
      .single();

    if (error || !newJob) {
      showToast('Failed to save job — please try again', 'error');
      setRewriteState('idle');
      return;
    }

    const job = newJob as WishlistedJob;
    setSelectedJob(job);
    setJobDesc(customJdText);
    setMatchScore(null);
    setSavedToProfile(false);
    setPrompt(buildCustomPromptText(selectedProfile, customJobTitle.trim(), customJobCompany.trim() || 'Client', customJdText));
    setRewriteState('ready');
  }

  // ── Generate match score + prompt (user-triggered) ───────────────────────

  const startMatchScore = useCallback(async () => {
    const prof = selectedProfile;
    const j = selectedJob;
    if (!prof || !j) return;

    setRewriteState('scoring');
    setMatchScore(null);

    let score: MatchScore | null = null;
    if (j.source_job_id && j.board === 'LinkedIn') {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const res = await fetch(`${supabaseUrl}/functions/v1/score-job-match`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
          body: JSON.stringify({ profile_id: prof.id, linkedin_job_id: j.source_job_id, account_id: account?.id ?? null }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.score !== undefined) {
            score = {
              score: data.score, summary: data.summary ?? '',
              strengths: data.strengths ?? [], gaps: data.gaps ?? [],
              optimization_points: Array.isArray(data.optimization_points) ? data.optimization_points : [],
            };
          }
        }
      } catch { /* non-fatal */ }
    }

    setMatchScore(score);
    setPrompt(buildPromptText(prof, j, score ?? undefined));
    setRewriteState('ready');
  }, [selectedProfile, selectedJob]);

  // ── Rewrite ───────────────────────────────────────────────────────────────

  async function rewriteResume() {
    if (!selectedProfile || !selectedJob) return;
    setRewriteState('rewriting');
    setSavedToProfile(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/rewrite-resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({
          profile_id: selectedProfile.id,
          wishlisted_job_id: selectedJob.id,
          account_id: account?.id ?? null,
          ...(customJdMode && customJdText ? { custom_job_description: customJdText.slice(0, 3000) } : {}),
        }),
      });

      const result = await res.json();
      if (!res.ok && !result.queued) throw new Error(result.error ?? `Rewrite failed: ${res.status}`);
      if (result.queued) { await pollForRewrite(result.job_id as string); return; }
      const txt = result.file_url ? await fetch(result.file_url).then(r => r.text()).catch(() => '') : '';
      applyRewriteResult(txt);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Rewrite failed', 'error');
      setRewriteState('ready');
    }
  }

  async function pollForRewrite(jobId: string) {
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const { data } = await supabase.from('llm_job_queue').select('status').eq('id', jobId).maybeSingle();
      if (!data) continue;
      if (data.status === 'completed') {
        const { data: updated } = await supabase.from('wishlisted_jobs').select('*').eq('id', selectedJob!.id).maybeSingle();
        const txt = updated?.rewrite_file_url ? await fetch(updated.rewrite_file_url as string).then(r => r.text()).catch(() => '') : '';
        applyRewriteResult(txt);
        return;
      }
      if (data.status === 'dead') throw new Error('Rewrite job failed after retries');
    }
    throw new Error('Rewrite timed out');
  }

  function applyRewriteResult(rawText: string) {
    const rw = parseResumeText(rawText);
    setRewritten(rw);
    const html = buildResumeHtml(selectedProfile!, rw, selectedTemplate);
    setResumeHtml(html);
    setChangeItems(buildChangeSummary(selectedProfile!, rw, selectedJob!));
    setRewriteState('done');
    setCol2Mode('preview');
  }

  function parseResumeText(text: string): RewrittenField {
    const lines = text.split('\n');
    let summaryLines: string[] = [], skillLines: string[] = [];
    let current: 'none' | 'summary' | 'skills' | 'other' = 'none';
    for (const line of lines) {
      const u = line.trim().toUpperCase();
      if (u.startsWith('PROFESSIONAL SUMMARY') || u === 'SUMMARY') { current = 'summary'; continue; }
      if (u.startsWith('TECHNICAL SKILLS') || u === 'SKILLS' || u.startsWith('CORE SKILLS')) { current = 'skills'; continue; }
      if (u.startsWith('EXPERIENCE') || u.startsWith('EDUCATION') || u.startsWith('WORK AUTH')) { current = 'other'; continue; }
      if (/^-{10,}$/.test(u.trim())) continue;
      if (current === 'summary') summaryLines.push(line);
      else if (current === 'skills') skillLines.push(line);
    }
    return {
      summary:   summaryLines.join('\n').trim() || `Experienced ${selectedProfile?.target_role ?? 'professional'} with ${selectedProfile?.years_experience ?? 'several'} years of experience.`,
      skills:    skillLines.join('\n').trim() || selectedProfile?.core_skills || '',
      experience: Array.isArray(selectedProfile?.experience) ? [...selectedProfile!.experience] : [],
      education:  Array.isArray(selectedProfile?.education)  ? [...selectedProfile!.education]  : [],
    };
  }

  // Keep html and change items in sync when rewritten changes in edit mode
  useEffect(() => {
    if (rewriteState === 'done' && selectedProfile && selectedJob) {
      setResumeHtml(buildResumeHtml(selectedProfile, rewritten, selectedTemplate));
      setChangeItems(buildChangeSummary(selectedProfile, rewritten, selectedJob));
    }
  }, [rewritten, rewriteState, selectedProfile, selectedJob, matchScore, selectedTemplate]);

  // ── Download PDF ──────────────────────────────────────────────────────────

  function downloadPdf() {
    if (!selectedProfile) return;
    const baseHtml = resumeHtml || buildResumeHtml(selectedProfile, rewritten, selectedTemplate);
    // Inject auto-print script so the new tab opens straight into the print dialog
    const htmlWithPrint = baseHtml.replace(
      '</body>',
      `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});<\/script></body>`
    );
    const blob = new Blob([htmlWithPrint], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const newWin = window.open(url, '_blank', 'noopener,noreferrer');
    if (!newWin) {
      // Popup blocked — fall back to direct HTML download
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedProfile.candidate_name.replace(/\s+/g, '_')}_resume.html`;
      a.click();
    }
    // Revoke after enough time for the tab to load
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  // ── Save to profile ───────────────────────────────────────────────────────

  async function saveToProfile() {
    if (!selectedProfile) return;
    setSavingToProfile(true);
    try {
      const pdfBlob = await buildResumePdf(selectedProfile, rewritten);

      // Determine next version: {FirstLast}_OGN_v1, _v2, ...
      const { data: existingFiles } = await supabase
        .from('resume_files')
        .select('file_name')
        .eq('profile_id', selectedProfile.id)
        .like('file_name', '%_OGN_v%');
      const maxV = (existingFiles ?? []).reduce((m: number, f: { file_name: string }) => {
        const match = f.file_name.match(/_OGN_v(\d+)/i);
        return match ? Math.max(m, parseInt(match[1])) : m;
      }, 0);
      const baseName = selectedProfile.candidate_name.trim().replace(/\s+/g, '') + `_OGN_v${maxV + 1}`;
      const safeName = `${baseName}.pdf`;

      const path = `${selectedProfile.id}/resume/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from('resumes').upload(path, pdfBlob, { contentType: 'application/pdf', upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(path);
      await supabase.from('resume_files').insert({ profile_id: selectedProfile.id, file_name: safeName, file_url: urlData.publicUrl, category: 'resume' });
      await supabase.from('activity_logs').insert({ profile_id: selectedProfile.id, event_type: 'resume_generated', description: `AI-tailored resume saved: ${safeName}` });

      // Refresh original files so the new one appears in the Col 1 dropdown
      const { data: refreshed } = await supabase.from('resume_files').select('*').eq('profile_id', selectedProfile.id).eq('category', 'resume').order('created_at', { ascending: false });
      if (refreshed) {
        setOriginalFiles(refreshed as ResumeFile[]);
        setSelectedOriginalFile((refreshed as ResumeFile[])[0] ?? null);
      }

      setSavedToProfile(true);
      showToast(`Saved as ${safeName}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    }
    setSavingToProfile(false);
  }

  async function openHistory() {
    if (!selectedProfile) return;
    setShowHistory(true);
    setLoadingHistory(true);
    const { data } = await supabase
      .from('resume_files')
      .select('*')
      .eq('profile_id', selectedProfile.id)
      .like('file_name', '%_rewritten%')
      .order('created_at', { ascending: false });
    setHistoryFiles((data as ResumeFile[]) ?? []);
    setLoadingHistory(false);
  }

  // ── Candidate sidebar ──────────────────────────────────────────────────
  const [candidateTab, setCandidateTab] = useState<'hotlist' | 'all'>('all');
  const [hotlistProfileIds, setHotlistProfileIds] = useState<string[]>([]);

  useEffect(() => {
    supabase.from('hotlist').select('profile_id').then(({ data }) => {
      if (data) setHotlistProfileIds(data.map((r: { profile_id: string }) => r.profile_id));
    });
  }, []);

  const filteredCandidates = allProfiles.filter(p => {
    const q = candidateQuery.toLowerCase();
    const matchQ = !q || p.candidate_name.toLowerCase().includes(q) || (p.target_role ?? '').toLowerCase().includes(q);
    if (!matchQ) return false;
    if (candidateTab === 'hotlist') return hotlistProfileIds.includes(p.id);
    return true;
  });

  // Queue jobs = wishlisted jobs with resume_ai_queued=true
  const queueJobs = savedJobs.filter(j => j.resume_ai_queued);

  // ── Render ────────────────────────────────────────────────────────────────

  const scoreColor = matchScore
    ? matchScore.score >= 75 ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : matchScore.score >= 50 ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-red-700 bg-red-50 border-red-200'
    : '';

  return (
    <div className="h-screen flex flex-col bg-gray-100 font-sans overflow-hidden">
      <AppNav />

      <div className="flex-1 grid grid-cols-[240px_260px_1fr_1fr] overflow-hidden min-h-0">

        {/* ── COL 1: Candidates Sidebar ──────────────────────────────────── */}
        <div className="flex flex-col overflow-hidden bg-white border-r border-gray-200 min-h-0">
          <div className="px-3 py-2.5 border-b border-gray-100 shrink-0">
            <div className="flex items-center mb-2">
              {(['hotlist', 'all'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setCandidateTab(tab)}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors capitalize text-center ${
                    candidateTab === tab ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                  }`}
                >
                  {tab === 'hotlist' ? 'Hotlist' : 'All Bench'}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search candidates..."
                value={candidateQuery}
                onChange={e => setCandidateQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 placeholder:text-gray-300"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {loadingProfiles ? (
              <div className="flex items-center justify-center py-10"><LogoSpinner size={18} /></div>
            ) : filteredCandidates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <User size={18} className="text-gray-300" />
                <p className="text-xs text-gray-400">{candidateTab === 'hotlist' ? 'No hotlisted candidates' : 'No candidates found'}</p>
              </div>
            ) : filteredCandidates.map(p => {
              const isSelected = selectedProfile?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => selectProfile(p)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-all ${
                    isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      <User size={13} className={isSelected ? 'text-blue-600' : 'text-gray-400'} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[12px] font-semibold truncate leading-tight ${isSelected ? 'text-blue-900' : 'text-gray-800'}`}>
                        {p.candidate_name}
                      </p>
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">{p.target_role || 'No target role'}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── COL 2: Resume AI Queue ─────────────────────────────────────── */}
        <div className="flex flex-col overflow-hidden bg-gray-50 border-r border-gray-200 min-h-0">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
            <PenLine size={13} className="text-violet-500 shrink-0" />
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Resume AI Queue</span>
            {queueJobs.length > 0 && (
              <span className="ml-auto text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-md">{queueJobs.length}</span>
            )}
          </div>

          {/* Custom JD toggle */}
          {selectedProfile && (
            <div className="px-3 pt-2.5 pb-1 shrink-0">
              <button
                onClick={() => { setCustomJdMode(!customJdMode); if (customJdMode) { setCustomJdText(''); setCustomJobTitle(''); setCustomJobCompany(''); setSelectedJob(null); setRewriteState('idle'); setMatchScore(null); setPrompt(''); setSavedToProfile(false); } }}
                className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${customJdMode ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-600'}`}
              >
                <PenLine size={11} /> {customJdMode ? 'Custom JD Mode' : 'Paste JD'}
              </button>
            </div>
          )}

          {!selectedProfile ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center">
                <PenLine size={20} className="text-violet-400" />
              </div>
              <p className="text-xs text-gray-400 max-w-[180px] leading-relaxed">Select a candidate to view their Resume AI queue.</p>
            </div>
          ) : loadingJobs ? (
            <div className="flex items-center justify-center py-10"><LogoSpinner size={18} /></div>
          ) : queueJobs.length === 0 && !customJdMode ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
              <Briefcase size={18} className="text-gray-300" />
              <p className="text-xs text-gray-400 leading-relaxed">No jobs in Resume AI queue. Add jobs from the Job Finder.</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5 min-h-0">
              {queueJobs.map(job => {
                const isSelected = selectedJob?.id === job.id;
                return (
                  <button
                    key={job.id}
                    onClick={() => { setCustomJdMode(false); selectJob(job); }}
                    className={`w-full text-left rounded-xl p-3 transition-all border ${
                      isSelected ? 'bg-white border-violet-200 shadow-sm' : 'bg-white border-gray-100 hover:border-gray-200 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`inline-flex text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                        job.board === 'LinkedIn' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        job.board === 'Dice' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                        job.board === 'Indeed' ? 'bg-violet-50 text-violet-700 border-violet-200' :
                        'bg-gray-50 text-gray-600 border-gray-200'
                      }`}>{job.board}</span>
                      {job.rewrite_file_url && (
                        <span className="flex items-center gap-0.5 text-[9px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                          <CheckCircle2 size={8} /> Done
                        </span>
                      )}
                    </div>
                    <p className={`text-[11px] font-bold leading-tight truncate ${isSelected ? 'text-violet-800' : 'text-gray-800'}`}>
                      {job.job_title}
                    </p>
                    <p className="text-[10px] text-gray-400 truncate mt-0.5">{job.company}{job.location ? ` · ${job.location}` : ''}</p>
                  </button>
                );
              })}
            </div>
          )}

          {selectedProfile && (
            <div className="px-3 py-2.5 border-t border-gray-100 bg-white shrink-0">
              <button onClick={openHistory}
                className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-200 px-3 py-2 rounded-xl transition-colors">
                <Clock size={11} /> Rewrite History
              </button>
            </div>
          )}
        </div>

        {/* ── COL 3: Original Resume ─────────────────────────────────────── */}
        <div className="flex flex-col overflow-hidden bg-gray-50 min-h-0">
          <div className="relative flex items-center gap-2 px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
            <FileText size={13} className="text-gray-500 shrink-0" />
            <button
              onClick={() => setShowFileDropdown(v => !v)}
              className="flex items-center gap-1 text-xs font-bold text-gray-700 uppercase tracking-wider hover:text-blue-600 transition-colors"
            >
              Original Resume
              <ChevronDown size={11} className={`transition-transform duration-150 ${showFileDropdown ? 'rotate-180' : ''}`} />
            </button>
            {selectedOriginalFile && (
              <span className="ml-auto text-[10px] text-gray-400 truncate max-w-[110px]" title={selectedOriginalFile.file_name}>
                {selectedOriginalFile.file_name}
              </span>
            )}
            {showFileDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowFileDropdown(false)} />
                <div className="absolute top-full left-0 right-0 z-50 mt-1 mx-2 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                  {originalFiles.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-gray-400">No resume files uploaded</p>
                  ) : (
                    originalFiles.map(f => (
                      <button key={f.id}
                        onClick={() => { setSelectedOriginalFile(f); setShowFileDropdown(false); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${selectedOriginalFile?.id === f.id ? 'bg-blue-50' : ''}`}
                      >
                        <FileText size={11} className={`shrink-0 ${selectedOriginalFile?.id === f.id ? 'text-blue-500' : 'text-gray-400'}`} />
                        <span className={`text-xs truncate ${selectedOriginalFile?.id === f.id ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>
                          {f.file_name}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            {selectedProfile ? (
              <OriginalResumeCol file={selectedOriginalFile} />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 h-full text-center px-6">
                <FileText size={20} className="text-gray-300" />
                <p className="text-xs text-gray-400">Select a candidate to view their resume.</p>
              </div>
            )}
          </div>
        </div>

        {/* ── COL 4: Rewritten Resume ────────────────────────────────────── */}
        <div className="flex flex-col overflow-hidden bg-white border-l border-gray-200 min-h-0">
          {!selectedProfile || (!selectedJob && !customJdMode) ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center">
                <Sparkles size={24} className="text-blue-400" />
              </div>
              <div>
                <p className="text-base font-bold text-gray-900">AI Resume Tailoring</p>
                <p className="text-sm text-gray-400 mt-1 max-w-sm">Select a candidate and a job from the queue to generate a tailored resume.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header bar */}
              <div className="relative flex items-center gap-2 px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
                <Sparkles size={13} className="text-blue-500 shrink-0" />
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Rewritten Resume</span>

                {/* Template picker */}
                <button
                  onClick={() => setShowTemplateDropdown(v => !v)}
                  className="ml-2 flex items-center gap-1 text-[10px] font-semibold text-gray-500 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-md transition-colors"
                >
                  <LayoutTemplate size={10} />
                  {RESUME_TEMPLATES.find(t => t.id === selectedTemplate)?.name ?? 'Classic'}
                  <ChevronDown size={9} className={`transition-transform duration-150 ${showTemplateDropdown ? 'rotate-180' : ''}`} />
                </button>
                {showTemplateDropdown && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowTemplateDropdown(false)} />
                    <div className="absolute top-full left-0 z-50 mt-1 ml-16 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden w-44">
                      {RESUME_TEMPLATES.map(t => (
                        <button key={t.id}
                          onClick={() => { setSelectedTemplate(t.id); setShowTemplateDropdown(false); }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${selectedTemplate === t.id ? 'bg-blue-50' : ''}`}
                        >
                          <LayoutTemplate size={11} className={selectedTemplate === t.id ? 'text-blue-500' : 'text-gray-400'} />
                          <span className={`text-xs ${selectedTemplate === t.id ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>{t.name}</span>
                          {selectedTemplate === t.id && <CheckCircle2 size={10} className="text-blue-500 ml-auto" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {matchScore && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border shrink-0 ml-auto ${scoreColor}`}>
                    {matchScore.score}/100
                  </span>
                )}

                {rewriteState === 'done' && (
                  <div className="flex items-center bg-gray-100 rounded-lg p-0.5 ml-2">
                    <button onClick={() => setCol2Mode('preview')} className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${col2Mode === 'preview' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>
                      <Eye size={10} /> Preview
                    </button>
                    <button onClick={() => setCol2Mode('edit')} className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${col2Mode === 'edit' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>
                      <Edit3 size={10} /> Edit
                    </button>
                  </div>
                )}
              </div>

              {/* Content area */}
              {rewriteState === 'idle' ? (
                customJdMode ? (
                  <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Job Title</p>
                        <input
                          value={customJobTitle}
                          onChange={e => setCustomJobTitle(e.target.value)}
                          placeholder="e.g. Senior Java Developer"
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                        />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Company / Client</p>
                        <input
                          value={customJobCompany}
                          onChange={e => setCustomJobCompany(e.target.value)}
                          placeholder="e.g. Acme Corp"
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                        />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Job Description</p>
                        <textarea
                          value={customJdText}
                          onChange={e => setCustomJdText(e.target.value)}
                          placeholder="Paste the full job description here..."
                          rows={10}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 placeholder-gray-400 leading-relaxed focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 resize-none font-mono"
                        />
                      </div>
                    </div>
                    <div className="shrink-0 px-4 py-3 border-t border-gray-100 bg-white">
                      <button
                        onClick={startCustomJdRewrite}
                        disabled={!customJobTitle.trim() || !customJdText.trim()}
                        className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm px-5 py-3 rounded-xl transition-colors shadow-sm"
                      >
                        <Zap size={15} /> Generate Prompt & Rewrite
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 text-center">
                    <div className="space-y-1.5">
                      <p className="text-sm font-bold text-gray-900">Ready to analyze</p>
                      <p className="text-xs text-gray-400 max-w-[220px] leading-relaxed">
                        Generate a match score between <span className="font-semibold text-gray-600">{selectedProfile?.candidate_name}</span> and this job, then create a tailored rewrite.
                      </p>
                    </div>
                    <button
                      onClick={startMatchScore}
                      className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm px-5 py-3 rounded-xl transition-colors shadow-sm"
                    >
                      <Zap size={15} /> Match Score & Create Prompt
                    </button>
                    {selectedJob && (
                      <p className="text-[10px] text-gray-400">
                        Job: <span className="font-semibold text-gray-600">{selectedJob.job_title} · {selectedJob.company}</span>
                      </p>
                    )}
                  </div>
                )
              ) : rewriteState === 'scoring' ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center">
                    <Zap size={20} className="text-amber-400 animate-pulse" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">Scoring Match...</p>
                    <p className="text-xs text-gray-400 mt-1">Analyzing fit for <span className="font-semibold text-gray-600">{selectedJob?.job_title ?? customJobTitle ?? 'role'}</span></p>
                  </div>
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map(i => (<div key={i} className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: `${i * .15}s` }} />))}
                  </div>
                </div>
              ) : rewriteState === 'ready' || rewriteState === 'rewriting' ? (
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                  {matchScore ? (
                    <div className="px-5 pt-4 pb-3 border-b border-gray-100 shrink-0">
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`text-2xl font-black tabular-nums leading-none ${matchScore.score >= 75 ? 'text-emerald-600' : matchScore.score >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
                          {matchScore.score}<span className="text-sm font-bold text-gray-300">/100</span>
                        </div>
                        <p className="text-xs text-gray-500 leading-snug flex-1">{matchScore.summary}</p>
                      </div>
                      {matchScore.optimization_points.length > 0 && (
                        <div className="space-y-2">
                          {matchScore.optimization_points.slice(0, 3).map((point, i) => (
                            <div key={i} className="flex items-start gap-2.5">
                              <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black leading-none mt-0.5
                                ${i === 0 ? 'bg-blue-100 text-blue-700' : i === 1 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {i + 1}
                              </span>
                              <p className="text-xs text-gray-700 leading-relaxed">{point}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="px-5 pt-3 pb-2 border-b border-gray-100 shrink-0 flex items-center gap-2 text-xs text-gray-400">
                      <AlertCircle size={12} className="shrink-0" />
                      Score unavailable — prompt below is pre-filled, edit and rewrite.
                    </div>
                  )}

                  <div className="px-5 pt-3 pb-1 shrink-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">AI Prompt</p>
                  </div>
                  <textarea
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    disabled={rewriteState === 'rewriting'}
                    className="flex-1 resize-none px-5 py-2 text-xs text-gray-600 leading-relaxed outline-none bg-white disabled:opacity-60 font-mono"
                    placeholder="Describe how you want the resume rewritten..."
                    spellCheck={false}
                  />

                  <div className="shrink-0 px-4 py-3 border-t border-gray-100 bg-white">
                    <button
                      onClick={rewriteResume}
                      disabled={rewriteState === 'rewriting'}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm px-4 py-3 rounded-xl transition-colors shadow-sm"
                    >
                      {rewriteState === 'rewriting'
                        ? <><LogoSpinner size={14} /> Rewriting...</>
                        : <><Sparkles size={14} /> Rewrite Resume</>}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                  <div className="flex-1 overflow-y-auto overflow-x-hidden bg-gray-200">
                    {col2Mode === 'preview' ? (
                      <ResumePreviewFrame html={resumeHtml} />
                    ) : (
                      <div className="bg-white min-h-full">
                        <ResumeEditor rw={rewritten} onChange={setRewritten} />
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 px-4 py-3 border-t border-gray-100 flex items-center gap-2 bg-white">
                    <button onClick={() => setRewriteState('ready')}
                      className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors">
                      <RotateCcw size={11} /> Redo
                    </button>
                    <button onClick={downloadPdf}
                      className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-400 px-3 py-1.5 rounded-lg transition-colors">
                      <Download size={11} /> Download PDF
                    </button>
                    <button onClick={saveToProfile} disabled={savingToProfile || savedToProfile}
                      className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60 ${savedToProfile ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                      {savingToProfile ? <><LogoSpinner size={11} /> Saving...</> : savedToProfile ? <><CheckCircle2 size={11} /> Saved</> : <><Save size={11} /> Save to Profile</>}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

      </div>

      {/* ── REWRITE HISTORY PANEL ──────────────────────────────────────────── */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowHistory(false)} />
          <div className="relative ml-auto w-full max-w-2xl bg-white flex flex-col shadow-2xl h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-2.5">
                <Clock size={16} className="text-gray-500" />
                <div>
                  <p className="text-sm font-bold text-gray-900">Rewrite History</p>
                  <p className="text-xs text-gray-400 mt-0.5">{selectedProfile?.candidate_name}</p>
                </div>
              </div>
              <button onClick={() => setShowHistory(false)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                <X size={16} className="text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingHistory ? (
                <div className="flex items-center justify-center h-32 gap-2 text-gray-400 text-sm">
                  <LogoSpinner size={16} /> Loading history...
                </div>
              ) : historyFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-6">
                  <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">
                    <FileText size={20} className="text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-700">No rewrites yet</p>
                    <p className="text-xs text-gray-400 mt-1">Rewritten resumes saved to profile will appear here.</p>
                  </div>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 px-6 py-3">Date</th>
                      <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 px-4 py-3">File</th>
                      <th className="text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 px-4 py-3">Job / Company</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {historyFiles.map(file => {
                      const date = file.created_at
                        ? new Date(file.created_at as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '';
                      const nameParts = (file.file_name ?? '').replace(/_rewritten\.pdf$/, '').replace(/_rewritten\.html$/, '').split('_');
                      const profileWordCount = (selectedProfile?.candidate_name ?? '').split(' ').length;
                      const jobLabel = nameParts.slice(profileWordCount).join(' ') || file.file_name;
                      return (
                        <tr key={file.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-3.5 text-xs text-gray-500 whitespace-nowrap">{date}</td>
                          <td className="px-4 py-3.5 text-xs text-gray-800 max-w-[180px]">
                            <span className="truncate block" title={file.file_name ?? undefined}>{file.file_name}</span>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-gray-600 max-w-[200px]">
                            <span className="truncate block">{jobLabel}</span>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            {file.file_url ? (
                              <a href={file.file_url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-100 px-2.5 py-1 rounded-lg transition-colors">
                                <Download size={11} /> Download
                              </a>
                            ) : (
                              <span className="text-xs text-gray-300">No file</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="shrink-0 px-6 py-3 border-t border-gray-100 bg-gray-50 text-xs text-gray-400">
              {historyFiles.length > 0 && `${historyFiles.length} rewrite${historyFiles.length > 1 ? 's' : ''} on record`}
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
