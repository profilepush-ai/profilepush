import { Check, Flame, Search, Send, Eye } from 'lucide-react';
import { Navigate, useSearchParams } from 'react-router-dom';
import SwipeDeck from '../components/match/SwipeDeck';
import MatchDetail from '../components/match/MatchDetail';
import MatchSheet from '../components/match/MatchSheet';
import TrackerStats from '../components/match/TrackerStats';
import ProfileStories from '../components/match/ProfileStories';
import SendResumeSheet from '../components/match/SendResumeSheet';
import StartupSplash from '../components/StartupSplash';
import PersonaGateScreen from '../components/PersonaGateScreen';
import BrandLoader from '../components/brand/BrandLoader';
import LogoSpinner from '../components/LogoSpinner';
import type { CardItem, Subject } from '../lib/today';

// Store listing screenshots: the real Today, detail and Tracker components
// with example data (IT jobs, sample names), so no customer's data or a real
// company's logo ends up in a public listing. Development only.
//   /store-shots?shot=today | avatar | detail | send | tracker | done | splash | role | loader

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const PROFILES: Record<string, Subject> = {
  ravi: { id: 'p-ravi', title: 'Java Full Stack Developer', name: 'Ravi K.', visa: 'H1B', locations: ['Dallas, TX'], years: 9, skills: ['Java', 'Spring Boot', 'React', 'AWS', 'Microservices', 'Kafka'], rate_min: 65, rate_max: 70, posted_at: hoursAgo(200), locked: 0, applied_today: 3, resumes: [{ id: 'r1', url: '#', file_name: 'Ravi_K_Java_Full_Stack.pdf', is_default: true }, { id: 'r2', url: '#', file_name: 'Ravi_K_Java_AWS.docx', is_default: false }] },
  anitha: { id: 'p-anitha', title: 'Senior Data Engineer', name: 'Anitha R.', visa: 'GC', locations: ['Plano, TX'], years: 11, skills: ['SQL', 'Python', 'Snowflake', 'Airflow', 'AWS'], rate_min: 70, posted_at: hoursAgo(300), locked: 0, applied_today: 1 },
  suresh: { id: 'p-suresh', title: 'DevOps Engineer', name: 'Suresh P.', visa: 'USC', locations: ['Reston, VA'], years: 8, skills: ['AWS', 'Terraform', 'Kubernetes', 'Docker'], rate_min: 80, posted_at: hoursAgo(400), locked: 0, applied_today: 0 },
};

function job(id: string, title: string, company: string, location: string, rate: number | null, skills: string[], picture: string, subject: Subject, fit: number, extra: Partial<CardItem> = {}): CardItem {
  return {
    card_id: `c-${id}`, subject_id: subject.id, lead_id: `l-${id}`, subject_kind: 'hotlist', fit, similarity: fit / 100,
    stage: 'new', closed_reason: null, viewed_at: null, saved_at: null, applied_at: null, added_at: hoursAgo(0.9),
    reply_in_inbox: false, how: 'email', subject,
    lead: {
      id: `l-${id}`, kind: 'job', title, company, poster: company, avatar: null, location, pay: null,
      rate_min: rate, rate_max: rate, skills, visas: ['H1B', 'GC', 'USC'], exp: 7, type: 'Contract', source: 'linkedin_scrape',
      post_url: null, apply_url: null, has_email: true, posted_at: hoursAgo(2), open: true, visuals: { a: picture, b: picture },
    },
    eng: { views: 24, applies: 5, saves: 3, shares: 2 },
    ...extra,
  };
}

const ITEMS: CardItem[] = [
  job('java', 'Senior Java Developer', 'Northwind Tech', 'Dallas, TX', 68, ['Java', 'Spring Boot', 'React', 'AWS', 'Kafka'], '/landing-v2/java.webp', PROFILES.ravi, 92),
  job('data', 'Data Engineer', 'Bluepeak Analytics', 'Plano, TX', 72, ['SQL', 'Python', 'Snowflake', 'Airflow'], '/landing-v2/data.webp', PROFILES.anitha, 88),
  job('cloud', 'Cloud DevOps Engineer', 'Granite Systems', 'Reston, VA', 85, ['AWS', 'Terraform', 'Kubernetes'], '/landing-v2/cloud.webp', PROFILES.suresh, 86),
];
const SUBJECTS = Object.fromEntries(Object.values(PROFILES).map((p) => [p.id, p]));
const noop = () => {};

// The search row and profile stories, as Today draws them over the card.
function TopBar() {
  return (controls: React.ReactNode) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/90 pl-3.5 pr-1.5 shadow-sm ring-1 ring-gray-200">
          <Search size={16} className="shrink-0 text-gray-400" /><span className="text-[14px] text-gray-400">Search</span>
        </label>
        {controls}
      </div>
      <ProfileStories kind="hotlist" subjects={Object.values(PROFILES)} filter="all" onFilter={noop} onAdd={noop}
        countsFor={(id) => (id === 'all' ? { total: 24, fresh: 13, seen: 8, expiring: 3 } : id === 'p-suresh' ? { total: 8, fresh: 0, seen: 8, expiring: 0 } : { total: 8, fresh: 5, seen: 2, expiring: 1 })} />
    </div>
  );
}

export default function StoreShots() {
  const [params] = useSearchParams();
  if (!import.meta.env.DEV) return <Navigate to="/" replace />;
  const shot = params.get('shot') ?? 'today';
  const deck = (items: CardItem[], avatarOn = false) => (
    <SwipeDeck items={items} kind="hotlist" subjects={SUBJECTS} startId={items[0].card_id} appliedToday={4} top={TopBar()} layer="z-[60]"
      boxes reelMs={60_000} expiring viewerId="demo" avatarOn={avatarOn} onCollapse={noop}
      onSeen={noop} onApply={noop} onSave={noop} onShare={noop} onDismiss={noop} onDetails={noop} />
  );

  if (shot === 'splash') return <StartupSplash hide={false} />;
  if (shot === 'role') return <PersonaGateScreen />;
  if (shot === 'loader') {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-10 bg-white">
        <BrandLoader width={260} label="Finding your matches" />
        <span className="flex items-end gap-6">{[14, 18, 24, 32].map((n) => <LogoSpinner key={n} size={n} />)}</span>
      </div>
    );
  }
  // The store's small screens: without the engagement row, so the picture shows.
  const bare = ITEMS.map((i) => ({ ...i, eng: undefined }));
  // Screenshot 1 leads with a different match than the avatar one.
  if (shot === 'today') return deck([bare[1], bare[0], bare[2]]);
  if (shot === 'avatar') return deck([{ ...bare[0], my_visual: '/landing-v2/avatar-job.webp' }], true);
  if (shot === 'detail' || shot === 'send') {
    return (
      <div className="h-[100dvh] bg-[#f3f2ee]">
        <MatchDetail item={ITEMS[0]} kind="hotlist" subject={PROFILES.ravi} mode="sheet"
          position={{ index: 0, total: 24, label: 'Match' }} accountId="demo" gmailConnected busy={false}
          onBack={noop} onPrev={noop} onNext={noop} onApplyEmail={noop} onApplySite={noop} onAskResume={noop} onSave={noop} onShare={noop}
          onDismiss={noop} onSubject={noop} onConnectGmail={noop} asked={[]} onAsk={noop} />
        {shot === 'send' && (
          <SendResumeSheet item={ITEMS[0]} subject={PROFILES.ravi} name="Ravi K." accountId="demo" gmailConnected onConnectGmail={noop} onClose={noop} onSend={noop}
            initialDraft={{ toName: 'Priya Shah', duplicate: null, subject: 'Ravi K. for Senior Java Developer (Dallas, TX)',
              body: 'Hi Priya,\n\nI have a strong fit for your Senior Java Developer role in Dallas, TX.\n\n- 9 years in Java, Spring Boot, React and AWS\n- Microservices and Kafka in production\n- H1B, local to Dallas, $68/hr on C2C\n\nResume attached. Happy to set up a call this week.\n\nThanks,' }} />
        )}
      </div>
    );
  }
  if (shot === 'tracker') {
    const statuses: Array<[string, string | null, string]> = [['interview', null, 'Round 2 Thu'], ['replied', null, 'Asked for rate'], ['submitted', null, ''], ['submitted', null, 'Follow up Fri'], ['placed', null, 'Starts Monday'], ['closed', 'no_response', '']];
    const rows: CardItem[] = [...ITEMS, ...ITEMS, ...ITEMS, ...ITEMS].map((it, i) => ({ ...it, card_id: `t-${i}`, stage: statuses[i % 6][0], closed_reason: statuses[i % 6][1], notes: statuses[i % 6][2], applied_at: hoursAgo(10 + i * 30) }));
    return (
      <div className="min-h-[100dvh] space-y-2 bg-[#f3f2ee] p-2">
        <TrackerStats kind="hotlist" items={rows} stats={{
          days: Array.from({ length: 14 }, (_, k) => ({ day: `d${k}`, matches: [12, 9, 14, 10, 0, 11, 13, 15, 12, 10, 16, 14, 11, 18][k], watched: [3, 2, 0, 4, 0, 5, 3, 6, 7, 4, 8, 6, 5, 9][k], applied: [1, 0, 2, 1, 0, 2, 1, 3, 2, 1, 4, 2, 3, 3][k] })),
          week: { matches: 96, watched: 45, applied: 18, saved: 7, passed: 9, asked: 5 }, all: { matches: 410, watched: 160, applied: 52, saved: 21, asked: 14 }, streak: 6,
        }} />
        <MatchSheet items={rows} kind="hotlist" mode="tracker" dateLabel="Applied" dateOf={(i) => i.applied_at} viewerId="demo" onOpen={noop} onStatus={noop} onNotes={noop} />
      </div>
    );
  }
  // 'done': the end of the day's reel.
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-white px-6 text-center text-gray-900">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-600 text-white shadow-[0_0_0_8px_rgba(16,185,129,.18)]"><Check size={32} strokeWidth={3} /></span>
      <h2 className="text-[26px] font-extrabold">Reel complete</h2>
      <p className="text-[13.5px] text-gray-500">You watched every new match.</p>
      <div className="grid w-full max-w-xs grid-cols-3 gap-2">
        {[[Eye, 24, 'watched', 'bg-gray-50 text-gray-900 ring-gray-200'], [Send, 4, 'applied', 'bg-emerald-50 text-emerald-700 ring-emerald-200'], [Flame, 6, 'day streak', 'bg-orange-50 text-orange-700 ring-orange-200']].map(([I, v, l, tone]) => {
          const Icon = I as typeof Eye;
          return <div key={l as string} className={`flex flex-col items-center gap-0.5 rounded-2xl px-2 py-2.5 ring-1 ${tone as string}`}><Icon size={16} /><b className="text-[22px] font-extrabold">{v as number}</b><span className="text-[11px] font-semibold opacity-80">{l as string}</span></div>;
        })}
      </div>
      <p className="text-[13.5px] text-gray-500">New matches arrive every 10 minutes.</p>
    </div>
  );
}
