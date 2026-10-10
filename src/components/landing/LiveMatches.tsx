import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, MapPin, Send, Share2, Timer, X } from 'lucide-react';
import { FitLine } from '../match/Visuals';
import { agoLabel, hashColor } from '../../lib/match-fit';
import { supabase } from '../../lib/supabase';
import { trackEvent } from '../../lib/track';

// The landing page's top card: the latest real matches (landing_live_matches,
// the job side only), shuffled like a deck. Every few seconds the top card
// flies off and the next one comes up; new matches join the front as they
// happen. Examples stand in until the live ones load, or if they can't.

export type LiveMatch = {
  id: string; title: string; company: string; location: string | null; rate_min: number | null; rate_max: number | null;
  skills: string[]; fit: number; matched_at: string; posted_at: string; how: 'email' | 'site'; picture: string;
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const EXAMPLES: LiveMatch[] = [
  { id: 'ex-java', title: 'Senior Java Developer', company: 'Northwind Tech', location: 'Dallas, TX', rate_min: 68, rate_max: 68, skills: ['Java', 'Spring Boot', 'AWS', 'React', 'Kafka'], fit: 91, matched_at: hoursAgo(0.3), posted_at: hoursAgo(2), how: 'email', picture: '/landing-v2/java.webp' },
  { id: 'ex-data', title: 'Data Engineer', company: 'Bluepeak Analytics', location: 'Plano, TX', rate_min: 72, rate_max: 72, skills: ['SQL', 'Python', 'Snowflake', 'Airflow'], fit: 88, matched_at: hoursAgo(0.7), posted_at: hoursAgo(3), how: 'site', picture: '/landing-v2/data.webp' },
  { id: 'ex-cloud', title: 'Cloud DevOps Engineer', company: 'Granite Systems', location: 'Reston, VA', rate_min: 85, rate_max: 85, skills: ['AWS', 'Terraform', 'Kubernetes', 'Docker'], fit: 86, matched_at: hoursAgo(1.2), posted_at: hoursAgo(5), how: 'email', picture: '/landing-v2/cloud.webp' },
];
const CYCLE_MS = 5500;
const FLY_MS = 450;
const POLL_MS = 60_000;

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const place = (loc: string | null) => (loc ?? '').replace(/,?\s*UNAVAILABLE\b/gi, '').trim();

async function fetchLive(): Promise<LiveMatch[] | null> {
  const { data, error } = await supabase.rpc('landing_live_matches' as never);
  if (error || !Array.isArray(data)) return null;
  return (data as LiveMatch[]).filter((m) => m && m.id && m.picture);
}

// Ticks down to when the match leaves Today (24 hours after it matched).
function TimeLeft({ from }: { from: string }) {
  const end = new Date(from).getTime() + 24 * 3_600_000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((end - now) / 1000));
  const two = (v: number) => String(v).padStart(2, '0');
  return <>{Math.floor(s / 3600)}:{two(Math.floor(s / 60) % 60)}:{two(s % 60)} left</>;
}

function Card({ m, top, live }: { m: LiveMatch; top: boolean; live: boolean }) {
  const rate = m.rate_min || m.rate_max ? `$${Math.round(Number(m.rate_min ?? m.rate_max))}/hr` : null;
  return (
    <div className="w-[300px] overflow-hidden rounded-[26px] bg-white text-gray-900 shadow-[0_30px_80px_rgba(11,26,58,.22)] ring-1 ring-black/5 sm:w-[330px]">
      <div className="relative">
        <img src={m.picture} alt="" draggable={false} className="h-[270px] w-full object-cover object-[50%_20%] sm:h-[290px]"
          style={{ maskImage: 'linear-gradient(180deg,#000 72%,transparent)', WebkitMaskImage: 'linear-gradient(180deg,#000 72%,transparent)' }} />
        {live && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-gray-800 shadow-sm backdrop-blur">
            <i className="relative grid h-2 w-2 place-items-center"><i className="absolute h-2 w-2 animate-ping rounded-full bg-emerald-400" /><i className="h-2 w-2 rounded-full bg-emerald-500" /></i>
            Live · matched {agoLabel(m.matched_at)} ago
          </span>
        )}
        <span className="absolute right-3 top-3 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-gray-700 backdrop-blur">AI picture</span>
      </div>
      <div className="-mt-8 space-y-2.5 px-4 pb-4">
        <div className="relative flex items-center gap-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[17px] font-extrabold text-white" style={{ background: hashColor(m.company) }}>{m.company.trim()[0]?.toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[14px]">{m.company}</b>
            <small className="block truncate text-[11.5px] text-gray-500">{m.how === 'site' ? 'Apply on site' : 'Apply by email'} · {agoLabel(m.posted_at)} ago</small>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[11px] font-bold tabular-nums text-gray-700"><Timer size={11} /><TimeLeft from={m.matched_at} /></span>
        </div>
        <h3 className="line-clamp-2 text-[20px] font-extrabold leading-tight tracking-tight">{m.title}</h3>
        <FitLine value={m.fit} animate={top} at={250} />
        <div className="flex flex-wrap gap-1.5 text-[12px] font-bold">
          {place(m.location) && <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-gray-100 px-2 py-[3px] text-gray-700"><MapPin size={11} />{place(m.location).split(',').slice(0, 2).join(',')}</span>}
          {rate && <span className="rounded-full bg-gray-100 px-2 py-[3px] text-gray-700">{rate}</span>}
          {m.skills.slice(0, 4).map((s) => <span key={s} className="max-w-full truncate rounded-full border-[1.5px] border-gray-300 px-2 py-[2px] text-gray-800">{s}</span>)}
        </div>
        <div className="grid grid-cols-4 gap-2 pt-1 text-center text-[10.5px] font-bold text-gray-600">
          {([[Send, 'Apply', 'bg-[#2563EB] text-white'], [Bookmark, 'Save', 'bg-gray-100 text-gray-700'], [Share2, 'Share', 'bg-gray-100 text-gray-700'], [X, 'Pass', 'bg-gray-100 text-gray-700']] as const).map(([Icon, label, tone]) => (
            <span key={label} className="flex flex-col items-center gap-1"><span className={`grid h-10 w-10 place-items-center rounded-full ${tone}`}><Icon size={17} /></span>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Where each of the three visible cards sits: on top, then fanned out behind.
const SLOTS: CSSProperties[] = [
  { transform: 'translateX(-50%) rotate(0deg) scale(1)', zIndex: 30, opacity: 1 },
  { transform: 'translateX(calc(-50% - 26px)) translateY(18px) rotate(-7deg) scale(.94)', zIndex: 20, opacity: 0.85 },
  { transform: 'translateX(calc(-50% + 26px)) translateY(10px) rotate(6deg) scale(.94)', zIndex: 10, opacity: 0.9 },
];

export default function LiveMatches() {
  const [items, setItems] = useState<LiveMatch[]>(EXAMPLES);
  const [live, setLive] = useState(false);
  const [leaving, setLeaving] = useState<1 | -1 | 0>(0);
  const paused = useRef(false);
  const navigate = useNavigate();
  const go = () => { trackEvent('landing_v2_start', { where: 'live_card' }); navigate('/signup'); };

  // The latest matches, then new ones at the front as they arrive.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const got = await fetchLive();
      if (!alive || !got || got.length < 3) return;
      setLive(true);
      setItems((cur) => {
        if (cur[0]?.id.startsWith('ex-')) return got;
        const known = new Set(cur.map((m) => m.id));
        const fresh = got.filter((m) => !known.has(m.id));
        return fresh.length ? [cur[0], ...fresh, ...cur.slice(1)].slice(0, 16) : cur;
      });
    };
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // The shuffle: the top card flies off (left or right) and goes to the back.
  useEffect(() => {
    let flip = 1 as 1 | -1;
    const t = setInterval(() => {
      if (paused.current || document.visibilityState !== 'visible') return;
      flip = (flip === 1 ? -1 : 1);
      if (reduced()) { setItems((cur) => [...cur.slice(1), cur[0]]); return; }
      setLeaving(flip);
      setTimeout(() => { setItems((cur) => [...cur.slice(1), cur[0]]); setLeaving(0); }, FLY_MS);
    }, CYCLE_MS);
    return () => clearInterval(t);
  }, []);

  const shown = items.slice(0, 3);
  return (
    <div role="link" tabIndex={0} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
      onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }}
      onFocus={() => { paused.current = true; }} onBlur={() => { paused.current = false; }}
      className="relative mx-auto block h-[560px] w-[330px] cursor-pointer outline-none sm:w-[360px]" aria-label={live ? 'The latest matches, live. Start free to get yours.' : 'Example matches. Start free to get yours.'}>
      {shown.map((m, i) => {
        const fly = i === 0 && leaving !== 0;
        const style: CSSProperties = fly
          ? { transform: `translateX(calc(-50% + ${leaving * 140}%)) rotate(${leaving * 18}deg)`, zIndex: 40, opacity: 0 }
          : SLOTS[i];
        return (
          <div key={m.id} className="absolute left-1/2 top-0 origin-bottom transition-[transform,opacity] ease-out"
            style={{ ...style, transitionDuration: `${fly ? FLY_MS : 500}ms` }} aria-hidden={i > 0}>
            <Card m={m} top={i === 0} live={live} />
          </div>
        );
      })}
    </div>
  );
}
