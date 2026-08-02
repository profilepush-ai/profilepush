import { useState, useEffect, useRef, useCallback } from 'react';
import {
  PenLine, Download, Sparkles, FileText,
  Upload, Eye, Edit3, Save, RotateCcw, CheckCircle2,
  ChevronDown, X, Zap, AlertCircle, LayoutTemplate,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

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
interface ResumeScore {
  overall: number;
  categories: { label: string; score: number; feedback: string }[];
  summary: string;
  strengths: string[];
  improvements: string[];
}

type PageState = 'idle' | 'scoring' | 'ready' | 'rewriting' | 'done';

interface UploadedResume {
  id: string;
  file_name: string;
  file_url: string;
  created_at: string;
}

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
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
@media print{html,body{background:#fff}.page{width:100%;margin:0;padding:0;box-shadow:none}.exp-item,.edu-item{break-inside:avoid}@page{size:A4;margin:18mm 20mm}}`,
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
@media print{html,body{background:#fff}.page{width:100%;margin:0;padding:0;box-shadow:none}.exp-item,.edu-item{break-inside:avoid}@page{size:A4;margin:18mm 20mm}}`,
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
@media print{html,body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:100%;margin:0;padding:0;box-shadow:none;border-top:none}.exp-item,.edu-item{break-inside:avoid}@page{size:A4;margin:18mm 20mm}}`,
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
@media print{html,body{background:#fff}.page{width:100%;margin:0;padding:0;box-shadow:none}.exp-item{border-left:none;padding-left:0}.exp-item,.edu-item{break-inside:avoid}@page{size:A4;margin:20mm 22mm}}`,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Resume HTML builder
// ─────────────────────────────────────────────────────────────────────────────

function buildResumeHtml(name: string, email: string, phone: string, location: string, rw: RewrittenField, templateId = 'classic'): string {
  const contactParts = [email, phone, location].filter(Boolean);
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
  ].filter(Boolean).join('');

  const templateCss = (RESUME_TEMPLATES.find(t => t.id === templateId) ?? RESUME_TEMPLATES[0]).css;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title></title><style>${templateCss}</style></head>
<body>
<div class="page">
  <div class="header">
    <h1>${escHtml(name || 'Your Name')}</h1>
    <div class="contact">${contactParts.map(p => `<span>${escHtml(p)}</span>`).join('')}</div>
  </div>
  ${sections}
</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF builder (jsPDF)
// ─────────────────────────────────────────────────────────────────────────────

async function buildResumePdf(name: string, email: string, phone: string, location: string, rw: RewrittenField): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const ML = 72, MR = 72, MT = 72, MB = 72;
  const CW = PW - ML - MR;
  let y = MT + 13;

  const skills = parseSkills(rw.skills);
  const contactParts = [email, phone, location].filter(Boolean);

  function checkY(needed: number) {
    if (y + needed > PH - MB) { doc.addPage(); y = MT + 10; }
  }

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

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(17, 17, 17);
  doc.text((name || 'Your Name').toUpperCase(), PW / 2, y, { align: 'center' });
  y += 20;

  if (contactParts.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text(contactParts.join('  ·  '), PW / 2, y, { align: 'center' });
    y += 8;
  }

  doc.setDrawColor(17, 17, 17);
  doc.setLineWidth(1.25);
  doc.line(ML, y, PW - MR, y);
  y += 14;

  if (rw.summary.trim()) {
    sectionHeader('Professional Summary');
    textBlock(rw.summary.trim(), ML, CW, 10, 'normal');
    y += 8;
  }

  if (skills.length) {
    sectionHeader('Technical Skills');
    textBlock(skills.join('  ·  '), ML, CW, 10, 'normal');
    y += 8;
  }

  if (rw.experience.length) {
    sectionHeader('Professional Experience');
    for (const exp of rw.experience) {
      checkY(40);
      const dates = `${exp.start_date} – ${exp.current ? 'Present' : exp.end_date}`;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(17, 17, 17);
      doc.text(exp.company, ML, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(80, 80, 80);
      doc.text(dates, PW - MR, y, { align: 'right' });
      y += 14;
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
      doc.text(edu.institution + (edu.gpa ? `  ·  GPA: ${edu.gpa}` : ''), ML, y);
      y += 14;
    }
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
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ResumeAIPage() {
  const { account } = useAuth();

  // Upload & Resume state (session-only, in-memory)
  const [uploadedResume, setUploadedResume] = useState<UploadedResume | null>(null);
  const [resumeText, setResumeText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [resumeFiles, setResumeFiles] = useState<UploadedResume[]>([]);
  const [col1Mode, setCol1Mode] = useState<'history' | 'preview'>('history');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Page state machine
  const [pageState, setPageState] = useState<PageState>('idle');

  // Score
  const [resumeScore, setResumeScore] = useState<ResumeScore | null>(null);
  const [scoring, setScoring] = useState(false);

  // Prompt
  const [prompt, setPrompt] = useState('');

  // Rewrite result
  const [rewritten, setRewritten] = useState<RewrittenField>({ summary: '', skills: '', experience: [], education: [] });
  const [resumeHtml, setResumeHtml] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('classic');
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [col3Mode, setCol3Mode] = useState<'preview' | 'edit'>('preview');

  // Save
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (msg: string, type: 'success' | 'error') => setToast({ message: msg, type });

  // ── Upload handler (in-memory only) ────────────────────────────────────

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const objectUrl = URL.createObjectURL(file);
    const uploaded: UploadedResume = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file_name: file.name,
      file_url: objectUrl,
      created_at: new Date().toISOString(),
    };

    setUploadedResume(uploaded);
    setResumeFiles(prev => [uploaded, ...prev]);
    setCol1Mode('preview');

    // Load text content for non-PDF/DOCX
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pdf') && !lower.match(/\.docx?$/)) {
      file.text().then(text => setResumeText(text)).catch(() => setResumeText('Could not read file.'));
    } else {
      setResumeText('');
    }

    // Reset downstream state
    setPageState('idle');
    setResumeScore(null);
    setPrompt('');
    setRewritten({ summary: '', skills: '', experience: [], education: [] });
    setResumeHtml('');
    setSaved(false);
    setUploading(false);

    if (fileInputRef.current) fileInputRef.current.value = '';
    showToast('Resume loaded', 'success');
  }

  function selectResumeFile(file: UploadedResume) {
    setUploadedResume(file);
    setCol1Mode('preview');

    // Load text content for non-PDF/DOCX
    const lower = file.file_name.toLowerCase();
    if (!lower.endsWith('.pdf') && !lower.match(/\.docx?$/)) {
      fetch(file.file_url).then(r => r.text()).then(setResumeText).catch(() => setResumeText('Could not read file.'));
    } else {
      setResumeText('');
    }

    // Reset downstream state
    setPageState('idle');
    setResumeScore(null);
    setPrompt('');
    setRewritten({ summary: '', skills: '', experience: [], education: [] });
    setResumeHtml('');
    setSaved(false);
  }

  // ── Score resume ───────────────────────────────────────────────────────

  const scoreResume = useCallback(async () => {
    if (!uploadedResume || !account?.id) return;
    setScoring(true);
    setResumeScore(null);

    try {
      // Read file content from blob URL to send to backend
      const fileBlob = await fetch(uploadedResume.file_url).then(r => r.blob());
      const fileBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1] ?? '');
        reader.readAsDataURL(fileBlob);
      });

      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/score-resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          account_id: account.id,
          resume_file_name: uploadedResume.file_name,
          resume_content_base64: fileBase64,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setResumeScore({
          overall: data.overall ?? data.score ?? 0,
          categories: data.categories ?? [],
          summary: data.summary ?? '',
          strengths: data.strengths ?? [],
          improvements: data.improvements ?? data.gaps ?? [],
        });
        setPageState('ready');
      } else {
        const err = await res.json().catch(() => null);
        showToast(err?.error ?? 'Scoring failed', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Scoring failed', 'error');
    }
    setScoring(false);
  }, [uploadedResume, account?.id]);

  // ── Rewrite resume ────────────────────────────────────────────────────

  async function rewriteResume() {
    if (!uploadedResume || !account?.id || !prompt.trim()) return;
    setPageState('rewriting');
    setSaved(false);

    try {
      // Read file content from blob URL
      const fileBlob = await fetch(uploadedResume.file_url).then(r => r.blob());
      const fileBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1] ?? '');
        reader.readAsDataURL(fileBlob);
      });

      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/rewrite-resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          account_id: account.id,
          resume_file_name: uploadedResume.file_name,
          resume_content_base64: fileBase64,
          custom_prompt: prompt,
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? `Rewrite failed: ${res.status}`);

      const txt = result.file_url ? await fetch(result.file_url).then(r => r.text()).catch(() => '') : (result.content ?? '');
      applyRewriteResult(txt);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Rewrite failed', 'error');
      setPageState('ready');
    }
  }

  function applyRewriteResult(rawText: string) {
    const rw = parseResumeText(rawText);
    setRewritten(rw);
    const html = buildResumeHtml('', '', '', '', rw, selectedTemplate);
    setResumeHtml(html);
    setPageState('done');
    setCol3Mode('preview');
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
      summary: summaryLines.join('\n').trim() || '',
      skills: skillLines.join('\n').trim() || '',
      experience: [],
      education: [],
    };
  }

  // Keep html in sync when rewritten changes in edit mode
  useEffect(() => {
    if (pageState === 'done') {
      setResumeHtml(buildResumeHtml('', '', '', '', rewritten, selectedTemplate));
    }
  }, [rewritten, pageState, selectedTemplate]);

  // ── Download ──────────────────────────────────────────────────────────

  function downloadPdf() {
    const baseHtml = resumeHtml || buildResumeHtml('', '', '', '', rewritten, selectedTemplate);
    const htmlWithPrint = baseHtml.replace(
      '</body>',
      `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},300);});<\/script></body>`
    );
    const blob = new Blob([htmlWithPrint], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const newWin = window.open(url, '_blank', 'noopener,noreferrer');
    if (!newWin) {
      const a = document.createElement('a');
      a.href = url;
      a.download = `resume_rewritten.html`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  // ── Save rewritten (download locally) ──────────────────────────────────

  async function saveRewritten() {
    setSaving(true);
    try {
      const pdfBlob = await buildResumePdf('', '', '', '', rewritten);
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resume_rewritten_${Date.now()}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setSaved(true);
      showToast('Resume downloaded', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Download failed', 'error');
    }
    setSaving(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const scoreColor = resumeScore
    ? resumeScore.overall >= 75 ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : resumeScore.overall >= 50 ? 'text-amber-700 bg-amber-50 border-amber-200'
    : 'text-red-700 bg-red-50 border-red-200'
    : '';

  return (
    <div className="h-screen flex flex-col bg-gray-100 font-sans overflow-hidden">
      <AppNav />

      <div className="flex-1 grid grid-cols-3 overflow-hidden min-h-0">

        {/* ═══════════════ COLUMN 1: Resume Upload & History/Preview ═══════════════ */}
        <div className="flex flex-col overflow-hidden bg-white border-r border-gray-200 min-h-0">
          {/* Header */}
          <div className="relative flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-200 shrink-0">
            <FileText size={14} className="text-blue-500 shrink-0" />
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Resume</span>
            {col1Mode === 'preview' && uploadedResume && (
              <button
                onClick={() => setCol1Mode('history')}
                className="ml-2 flex items-center gap-1 text-[10px] font-semibold text-gray-500 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-md transition-colors"
              >
                <ChevronDown size={9} /> All Files
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="ml-auto flex items-center gap-1 text-[10px] font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              <Upload size={11} /> {uploading ? 'Uploading...' : 'Upload'}
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.txt" onChange={handleUpload} className="hidden" />
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-hidden min-h-0">
            {col1Mode === 'history' ? (
              /* ── History list ── */
              <div className="flex flex-col h-full">
                {resumeFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
                    <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
                      <Upload size={24} className="text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-700">Upload a Resume</p>
                      <p className="text-xs text-gray-400 mt-1 max-w-[220px]">Upload a PDF, DOC, or DOCX file to get started with AI scoring and rewriting.</p>
                    </div>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors"
                    >
                      <Upload size={14} /> Choose File
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto">
                    <div className="px-3 py-2 border-b border-gray-100">
                      <span className="text-[10px] font-medium text-gray-400">{resumeFiles.length} resume{resumeFiles.length !== 1 ? 's' : ''} uploaded</span>
                    </div>
                    {resumeFiles.map(f => {
                      const isActive = uploadedResume?.id === f.id;
                      const date = new Date(f.created_at);
                      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                      const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                      return (
                        <button
                          key={f.id}
                          onClick={() => selectResumeFile(f)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-50 transition-colors ${
                            isActive ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                          }`}
                        >
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isActive ? 'bg-blue-100' : 'bg-gray-100'}`}>
                            <FileText size={14} className={isActive ? 'text-blue-600' : 'text-gray-400'} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`text-xs font-semibold truncate ${isActive ? 'text-blue-900' : 'text-gray-800'}`}>
                              {f.file_name}
                            </p>
                            <p className="text-[10px] text-gray-400 mt-0.5">{dateStr} at {timeStr}</p>
                          </div>
                          {isActive && <CheckCircle2 size={12} className="text-blue-500 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* ── Preview mode ── */
              uploadedResume ? (
                uploadedResume.file_name.toLowerCase().endsWith('.pdf') ? (
                  <iframe src={`${uploadedResume.file_url}#toolbar=0`} className="w-full h-full border-0" title="Resume Preview" />
                ) : uploadedResume.file_name.toLowerCase().match(/\.docx?$/) ? (
                  <iframe src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(uploadedResume.file_url)}`} className="w-full h-full border-0" title="Resume Preview" />
                ) : (
                  <pre className="h-full overflow-y-auto px-4 py-3 text-xs text-gray-700 leading-relaxed whitespace-pre-wrap font-mono bg-white">
                    {resumeText || 'No content.'}
                  </pre>
                )
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
                  <FileText size={20} className="text-gray-300" />
                  <p className="text-xs text-gray-400">No resume selected</p>
                </div>
              )
            )}
          </div>
        </div>

        {/* ═══════════════ COLUMN 2: Score Breakdown + Prompt ═══════════════ */}
        <div className="flex flex-col overflow-hidden bg-gray-50 border-r border-gray-200 min-h-0">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-200 shrink-0">
            <Zap size={14} className="text-amber-500 shrink-0" />
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Score & Prompt</span>
            {resumeScore && (
              <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-lg border shrink-0 ${scoreColor}`}>
                {resumeScore.overall}/100
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {!uploadedResume ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
                <Zap size={20} className="text-gray-300" />
                <p className="text-xs text-gray-400 max-w-[200px]">Upload a resume to generate a score breakdown and add your rewrite prompts.</p>
              </div>
            ) : !resumeScore && !scoring ? (
              <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-6">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
                  <Zap size={22} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">Score This Resume</p>
                  <p className="text-xs text-gray-400 mt-1 max-w-[220px] leading-relaxed">
                    Analyze the resume for ATS readiness, formatting, content quality, and keyword optimization.
                  </p>
                </div>
                <button
                  onClick={scoreResume}
                  className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm px-5 py-3 rounded-xl transition-colors shadow-sm"
                >
                  <Zap size={15} /> Generate Score
                </button>
              </div>
            ) : scoring ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
                <LogoSpinner size={20} />
                <div>
                  <p className="text-sm font-bold text-gray-900">Analyzing Resume...</p>
                  <p className="text-xs text-gray-400 mt-1">Scoring content, formatting, and ATS readiness</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full min-h-0">
                {/* Score breakdown */}
                <div className="px-4 pt-4 pb-3 border-b border-gray-200 shrink-0 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className={`text-3xl font-black tabular-nums leading-none ${
                      resumeScore!.overall >= 75 ? 'text-emerald-600' :
                      resumeScore!.overall >= 50 ? 'text-amber-500' : 'text-red-500'
                    }`}>
                      {resumeScore!.overall}<span className="text-sm font-bold text-gray-300">/100</span>
                    </div>
                    <p className="text-xs text-gray-500 leading-snug flex-1">{resumeScore!.summary}</p>
                  </div>

                  {/* Category scores */}
                  {resumeScore!.categories.length > 0 && (
                    <div className="space-y-2">
                      {resumeScore!.categories.map((cat, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] font-semibold text-gray-700">{cat.label}</span>
                              <span className={`text-[10px] font-bold ${
                                cat.score >= 75 ? 'text-emerald-600' :
                                cat.score >= 50 ? 'text-amber-600' : 'text-red-600'
                              }`}>{cat.score}</span>
                            </div>
                            <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  cat.score >= 75 ? 'bg-emerald-500' :
                                  cat.score >= 50 ? 'bg-amber-500' : 'bg-red-500'
                                }`}
                                style={{ width: `${cat.score}%` }}
                              />
                            </div>
                            {cat.feedback && <p className="text-[9px] text-gray-400 mt-0.5">{cat.feedback}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Strengths */}
                  {resumeScore!.strengths.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 mb-1">Strengths</p>
                      <ul className="space-y-0.5">
                        {resumeScore!.strengths.slice(0, 3).map((s, i) => (
                          <li key={i} className="text-[11px] text-gray-600 flex items-start gap-1.5">
                            <CheckCircle2 size={10} className="text-emerald-500 shrink-0 mt-0.5" />
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Improvements */}
                  {resumeScore!.improvements.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1">Improvements</p>
                      <ul className="space-y-0.5">
                        {resumeScore!.improvements.slice(0, 3).map((s, i) => (
                          <li key={i} className="text-[11px] text-gray-600 flex items-start gap-1.5">
                            <AlertCircle size={10} className="text-amber-500 shrink-0 mt-0.5" />
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    onClick={scoreResume}
                    disabled={scoring}
                    className="w-full flex items-center justify-center gap-1.5 text-[10px] font-semibold text-gray-500 hover:text-gray-700 bg-white border border-gray-200 hover:border-gray-300 px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    <RotateCcw size={10} /> Re-score
                  </button>
                </div>

                {/* Prompt area */}
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="px-4 pt-3 pb-1 shrink-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Rewrite Prompt</p>
                    <p className="text-[9px] text-gray-400 mt-0.5">Describe how you want the resume rewritten — style, focus areas, keywords, etc.</p>
                  </div>
                  <textarea
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    disabled={pageState === 'rewriting'}
                    className="flex-1 resize-none px-4 py-2 text-xs text-gray-700 leading-relaxed outline-none bg-white disabled:opacity-60 font-mono border-t border-gray-100"
                    placeholder="e.g., Rewrite this resume to emphasize cloud architecture skills. Add more quantified achievements. Make it ATS-friendly for a Senior DevOps Engineer role..."
                    spellCheck={false}
                  />
                  <div className="shrink-0 px-4 py-3 border-t border-gray-100 bg-white">
                    <button
                      onClick={rewriteResume}
                      disabled={pageState === 'rewriting' || !prompt.trim()}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm px-4 py-3 rounded-xl transition-colors shadow-sm"
                    >
                      {pageState === 'rewriting'
                        ? <><LogoSpinner size={14} /> Rewriting...</>
                        : <><Sparkles size={14} /> Rewrite Resume</>}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════ COLUMN 3: AI Rewritten Resume ═══════════════ */}
        <div className="flex flex-col overflow-hidden bg-white min-h-0">
          {/* Header */}
          <div className="relative flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-200 shrink-0">
            <Sparkles size={14} className="text-blue-500 shrink-0" />
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">AI Rewritten</span>

            {/* Template picker */}
            {pageState === 'done' && (
              <>
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

                <div className="flex items-center bg-gray-100 rounded-lg p-0.5 ml-auto">
                  <button onClick={() => setCol3Mode('preview')} className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${col3Mode === 'preview' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>
                    <Eye size={10} /> Preview
                  </button>
                  <button onClick={() => setCol3Mode('edit')} className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors ${col3Mode === 'edit' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>
                    <Edit3 size={10} /> Edit
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Content area */}
          {pageState !== 'done' ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
              {pageState === 'rewriting' ? (
                <>
                  <div className="flex justify-center gap-1.5 mb-2">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: `${i * .15}s` }} />
                    ))}
                  </div>
                  <p className="text-sm font-bold text-gray-900">Rewriting Resume...</p>
                  <p className="text-xs text-gray-400">Optimizing content based on your prompt</p>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center">
                    <Sparkles size={24} className="text-blue-400" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-gray-900">AI Rewritten Resume</p>
                    <p className="text-sm text-gray-400 mt-1 max-w-sm">Score your resume and write a prompt to generate an AI-tailored version.</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto overflow-x-hidden bg-gray-200 min-h-0">
                {col3Mode === 'preview' ? (
                  <ResumePreviewFrame html={resumeHtml} />
                ) : (
                  <div className="bg-white min-h-full">
                    <ResumeEditor rw={rewritten} onChange={setRewritten} />
                  </div>
                )}
              </div>
              <div className="shrink-0 px-4 py-3 border-t border-gray-100 flex items-center gap-2 bg-white">
                <button onClick={() => setPageState('ready')}
                  className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors">
                  <RotateCcw size={11} /> Redo
                </button>
                <button onClick={downloadPdf}
                  className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-400 px-3 py-1.5 rounded-lg transition-colors">
                  <Download size={11} /> Download PDF
                </button>
                <button onClick={saveRewritten} disabled={saving || saved}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60 ${saved ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                  {saving ? <><LogoSpinner size={11} /> Saving...</> : saved ? <><CheckCircle2 size={11} /> Saved</> : <><Save size={11} /> Save</>}
                </button>
              </div>
            </>
          )}
        </div>

      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
