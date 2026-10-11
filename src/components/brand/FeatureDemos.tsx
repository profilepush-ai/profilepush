import { useEffect, useState } from 'react';
import { Check, Mail, Send, Sparkles } from 'lucide-react';
import { FitLine } from '../match/Visuals';

// Small looping pictures of what ProfilePush does, for the first-launch
// slides and the AI Match wait. Example data only.

// Slide 2: a match card that gets pushed off and comes back, over and over.
export function PushDemo() {
  const pics = ['/landing-v2/java.webp', '/landing-v2/data.webp', '/landing-v2/cloud.webp'];
  const titles = ['Senior Java Developer', 'Data Engineer', 'Cloud DevOps Engineer'];
  const [n, setN] = useState(0);
  useEffect(() => { const t = setInterval(() => setN((x) => x + 1), 2200); return () => clearInterval(t); }, []);
  const k = n % 3;
  return (
    <div className="relative h-[330px] w-[250px] overflow-hidden rounded-[26px] bg-white shadow-[0_24px_60px_rgba(11,26,58,.18)] ring-1 ring-black/5">
      <div key={n} className="absolute inset-0" style={{ animation: n ? 'ppPushInL 420ms cubic-bezier(.25,.8,.25,1) both' : undefined }}>
        <img src={pics[k]} alt="" className="h-[210px] w-full object-cover object-[50%_20%]" style={{ maskImage: 'linear-gradient(180deg,#000 70%,transparent)', WebkitMaskImage: 'linear-gradient(180deg,#000 70%,transparent)' }} />
        <div className="space-y-2 px-3.5 pb-3.5">
          <b className="block text-[17px] font-extrabold leading-tight">{titles[k]}</b>
          <FitLine value={[92, 88, 86][k]} />
          <div className="flex gap-1.5 text-[11px] font-bold">{['Java', 'AWS', 'SQL'].map((s) => <span key={s} className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-emerald-500 px-2 py-[1px]"><Check size={10} strokeWidth={3} />{s}</span>)}</div>
        </div>
      </div>
      {n > 0 && (
        <div key={`s${n}`} aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ animation: 'ppSeamL 420ms cubic-bezier(.25,.8,.25,1) both' }}>
          <svg width="80" height="46" viewBox="0 0 112 64" fill="none" className="absolute left-[-6px] top-1/2" style={{ transform: 'translateY(-50%) scaleX(-1)' }}>
            <polyline points="26,12 46,32 26,52" stroke="#2563EB" strokeOpacity=".45" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="62" cy="21" r="7.5" fill="#FACC15" /><circle cx="62" cy="43" r="7.5" fill="#F97316" />
            <polyline points="78,8 102,32 78,56" stroke="#2563EB" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  );
}

// Slide 3: the Send resume sheet, the email writing itself.
export function SendDemo() {
  return (
    <div className="w-[270px] space-y-2.5 rounded-[24px] bg-white p-3.5 text-left shadow-[0_24px_60px_rgba(11,26,58,.18)] ring-1 ring-black/5">
      {[['Ravi_K_Java.pdf', true, 'PDF'], ['Ravi_K_AWS.docx', false, 'DOC']].map(([f, on, t]) => (
        <div key={f as string} className={`flex items-center gap-2 rounded-xl border-[1.5px] px-2.5 py-2 ${on ? 'border-blue-600 bg-blue-50/60' : 'border-gray-200'}`}>
          <span className={`grid h-4 w-4 place-items-center rounded-full ${on ? 'bg-blue-600 text-white' : 'ring-[1.5px] ring-gray-300'}`}>{on && <Check size={10} strokeWidth={4} />}</span>
          <span className={`grid h-6 w-6 place-items-center rounded-md text-[8px] font-extrabold ${t === 'PDF' ? 'bg-red-50 text-red-600' : 'bg-blue-100 text-blue-700'}`}>{t as string}</span>
          <span className="truncate text-[12.5px] font-semibold">{f as string}</span>
        </div>
      ))}
      <div className="space-y-1.5 rounded-xl border border-gray-200 p-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500"><Mail size={12} />AI is writing the email</p>
        {[96, 100, 82, 64].map((w, i) => <i key={w} className="block h-2 origin-left rounded-full bg-gray-200" style={{ width: `${w}%`, animation: `ppTypeLine 2.4s ease-out ${i * 0.25}s infinite` }} />)}
      </div>
      <span className="flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 text-[13.5px] font-bold text-white"><Send size={15} />Send resume</span>
    </div>
  );
}

// Slide 4: the tracker as a sheet.
export function SheetDemo() {
  const rows: Array<[string, string, string]> = [['Senior Java Developer', 'Interview', '#7c3aed'], ['Data Engineer', 'Replied', '#2563eb'], ['Cloud DevOps Engineer', 'Placed', '#059669'], ['React Developer', 'Applied', '#94a3b8'], ['SAP FICO Consultant', 'Replied', '#2563eb']];
  return (
    <div className="w-[290px] overflow-hidden rounded-[18px] bg-white text-left shadow-[0_24px_60px_rgba(11,26,58,.18)] ring-1 ring-black/5">
      <div className="grid grid-cols-[1fr_auto] border-b border-gray-200 bg-[#f8f9fa] px-3 py-2 text-[11px] font-bold text-gray-500"><span>Job</span><span>Status</span></div>
      {rows.map(([t, s, c], i) => (
        <div key={t} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-gray-100 px-3 py-2.5 text-[12.5px]" style={{ animation: `ppFadeUp .4s ease-out ${i * 0.08}s both` }}>
          <b className="truncate font-semibold text-blue-700">{t}</b>
          <span className="inline-flex items-center gap-1.5 font-bold text-gray-700"><i className="h-2 w-2 rounded-full" style={{ background: c }} />{s}</span>
        </div>
      ))}
    </div>
  );
}

// ProfilePush Apply filling a career site's form, field by field.
export function ExtensionDemo() {
  const fields: Array<[string, string]> = [['Full name', 'Ravi K.'], ['Email', 'ravi.k@example.com'], ['Work authorization', 'H1B'], ['Years of experience', '9'], ['Expected rate', '$68/hr']];
  const [n, setN] = useState(0);
  useEffect(() => { const t = setInterval(() => setN((x) => (x >= fields.length + 2 ? 0 : x + 1)), 650); return () => clearInterval(t); }, [fields.length]);
  return (
    <div className="w-[270px] space-y-2 rounded-[20px] bg-white p-3.5 text-left shadow-[0_24px_60px_rgba(11,26,58,.18)] ring-1 ring-black/5">
      <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#2563EB]"><Sparkles size={12} />ProfilePush Apply is filling this form</p>
      {fields.map(([label, value], i) => (
        <div key={label}>
          <span className="block text-[10.5px] font-semibold text-gray-500">{label}</span>
          <span className={`flex h-8 items-center rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors ${i < n ? 'border-[#2563EB]/40 bg-blue-50/50 text-gray-900' : 'border-gray-200 text-transparent'}`}>
            {i < n ? value : '.'}{i < n && <Check size={12} strokeWidth={3} className="ml-auto text-emerald-600" />}
          </span>
        </div>
      ))}
    </div>
  );
}

const FEATURES: Array<{ visual: React.ReactNode; title: string; text: string }> = [
  { visual: <PushDemo />, title: 'Swipe. Push. Apply.', text: 'Your matches play as a reel: the score, the skills that fit and an AI picture of the role.' },
  { visual: <SendDemo />, title: 'Send the resume in one tap', text: 'Pick a resume and AI writes the email to the poster, sent from your own Gmail.' },
  { visual: <SheetDemo />, title: 'Every application in one sheet', text: 'Replies, interviews and placements, tracked for you. Copy it into Google Sheets anytime.' },
  { visual: <ExtensionDemo />, title: 'Career sites, filled for you', text: 'The ProfilePush Apply Chrome extension fills the application. You press Apply.' },
];

// What ProfilePush does, one feature at a time, while something works.
export function FeatureShowcase({ every = 4500 }: { every?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % FEATURES.length), every); return () => clearInterval(t); }, [every]);
  const f = FEATURES[i];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <div key={i} className="flex min-h-0 flex-col items-center gap-5" style={{ animation: 'ppFadeUp .5s cubic-bezier(.2,.8,.2,1) both' }}>
        <div className="grid min-h-[300px] place-items-center">{f.visual}</div>
        <div className="max-w-sm">
          <b className="block text-balance text-[24px] font-extrabold leading-tight tracking-tight text-[#0B1A3A]">{f.title}</b>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-gray-600">{f.text}</p>
        </div>
      </div>
      <div className="flex gap-1.5" aria-hidden="true">
        {FEATURES.map((_, k) => <i key={k} className={`h-1.5 rounded-full transition-all ${k === i ? 'w-5 bg-[#2563EB]' : 'w-1.5 bg-gray-300'}`} />)}
      </div>
    </div>
  );
}
