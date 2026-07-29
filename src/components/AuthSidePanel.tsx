import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Logo from './Logo';

const COUNTER_REFRESH_MS = 30000;
const FALLBACK_RECRUITER_COUNT = 500;

function formatRecruiterCount(count: number | null): string {
  if (count === null) return '...';
  return new Intl.NumberFormat('en-US').format(count);
}

const RECRUITER_AVATARS = [
  { name: 'Aarav', src: 'https://i.pravatar.cc/64?img=12' },
  { name: 'Sophia', src: 'https://i.pravatar.cc/64?img=32' },
  { name: 'Diego', src: 'https://i.pravatar.cc/64?img=15' },
  { name: 'Meera', src: 'https://i.pravatar.cc/64?img=41' },
  { name: 'Noah', src: 'https://i.pravatar.cc/64?img=22' },
  { name: 'Anika', src: 'https://i.pravatar.cc/64?img=47' },
];

export default function AuthSidePanel() {
  const [recruiterCount, setRecruiterCount] = useState<number | null>(FALLBACK_RECRUITER_COUNT);

  useEffect(() => {
    let active = true;

    async function loadRecruiterCount() {
      try {
        const { data, error } = await supabase.rpc('get_public_recruiter_count');

        if (!active) return;
        if (error) {
          console.error('Failed to load recruiter count:', error.message);
          setRecruiterCount(FALLBACK_RECRUITER_COUNT);
          return;
        }

        const parsed = typeof data === 'number' ? data : Number(data ?? 0);
        const safeCount = Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_RECRUITER_COUNT;
        setRecruiterCount(safeCount);
      } catch (err) {
        if (!active) return;
        console.error('Failed to load recruiter count:', err);
        setRecruiterCount(FALLBACK_RECRUITER_COUNT);
      }
    }

    void loadRecruiterCount();
    const intervalId = window.setInterval(() => {
      void loadRecruiterCount();
    }, COUNTER_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div className="hidden lg:flex lg:w-1/2 bg-gray-100 flex-col justify-between p-12">
      <Link to="/" className="flex items-center gap-2 font-bold text-lg text-gray-300">
        <Logo size="lg" />
      </Link>

      <div className="flex-1 flex items-center">
        <div className="max-w-xl">
          <span className="block text-8xl xl:text-9xl 2xl:text-[10rem] leading-[0.9] font-extrabold tracking-tight bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 bg-clip-text text-transparent">
            {recruiterCount === null ? '...' : `${formatRecruiterCount(recruiterCount)}+`}
          </span>
          <p className="mt-2 text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">
            Recruiters joined already and loving it.
          </p>

          <div className="mt-10 flex items-center gap-4">
            <div className="flex -space-x-3">
              {RECRUITER_AVATARS.map((avatar) => (
                <img
                  key={avatar.name}
                  src={avatar.src}
                  alt={`${avatar.name} avatar`}
                  className="h-11 w-11 rounded-full border-2 border-white object-cover shadow-sm"
                  loading="lazy"
                />
              ))}
            </div>
            <p className="text-sm font-medium text-gray-400">Real recruiters. Real momentum.</p>
          </div>
        </div>
      </div>

      <p className="text-gray-400 text-xs">© {new Date().getFullYear()} ProfilePush · Built for Bench Sales Recruiters</p>
    </div>
  );
}
