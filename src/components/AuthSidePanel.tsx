import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Logo from './Logo';

const COUNTER_REFRESH_MS = 30000;

function formatRecruiterCount(count: number | null): string {
  if (count === null) return '...';
  return new Intl.NumberFormat('en-US').format(count);
}

export default function AuthSidePanel() {
  const [recruiterCount, setRecruiterCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    async function loadRecruiterCount() {
      const { data, error } = await supabase.rpc('get_public_recruiter_count');

      if (!active) return;
      if (error) {
        console.error('Failed to load recruiter count:', error.message);
        return;
      }

      const parsed = typeof data === 'number' ? data : Number(data ?? 0);
      setRecruiterCount(Number.isFinite(parsed) ? parsed : 0);
    }

    loadRecruiterCount();
    const intervalId = window.setInterval(loadRecruiterCount, COUNTER_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div className="hidden lg:flex lg:w-1/2 bg-gray-100 flex-col justify-between p-12">
      <Link to="/" className="flex items-center gap-2 font-bold text-lg">
        <Logo size="lg" />
      </Link>

      <div className="flex-1 flex items-center">
        <div>
          <h2 className="text-3xl font-extrabold text-gray-900 leading-tight">
            AI Copilot for Bench Sales
            <br />
            Recruiters to Hit 10X Submissions.
          </h2>
          <p className="text-gray-500 text-sm mt-5">
            {formatRecruiterCount(recruiterCount)} recruiters using profilepush.ai
          </p>
        </div>
      </div>

      <p className="text-gray-400 text-xs">© {new Date().getFullYear()} ProfilePush · Built for Bench Sales Recruiters</p>
    </div>
  );
}
