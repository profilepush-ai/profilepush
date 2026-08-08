import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Copy, Lock, Terminal } from 'lucide-react';
import LogoSpinner from '../components/LogoSpinner';

function buildProjectRef(url: string) {
  try {
    const host = new URL(url).hostname;
    return host.split('.')[0] ?? '';
  } catch {
    return '';
  }
}

async function verifyAdminPassword(password: string) {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-stats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, start_date: null, end_date: null }),
  });
  return response.ok;
}

export default function AdminCommands() {
  const [authed, setAuthed] = useState(Boolean(sessionStorage.getItem('admin_authed')));
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');

  const [workerUrl, setWorkerUrl] = useState('https://profilepush-social-job-parser.<your-subdomain>.workers.dev');
  const [workerToken, setWorkerToken] = useState('<set-secure-token>');
  const [parserModel, setParserModel] = useState('@cf/meta/llama-3.1-8b-instruct-fp8');
  const [supabaseProjectRef, setSupabaseProjectRef] = useState(buildProjectRef(import.meta.env.VITE_SUPABASE_URL ?? ''));

  const commands = useMemo(() => {
    const deployWorker = [
      'cd cloudflare/social-job-parser',
      'wrangler secret put WORKER_AUTH_TOKEN',
      'wrangler deploy',
    ].join('\n');

    const setSupabaseSecrets = [
      `supabase link --project-ref ${supabaseProjectRef || '<project-ref>'}`,
      `supabase secrets set CLOUDFLARE_WORKER_URL=\"${workerUrl}\"`,
      `supabase secrets set CLOUDFLARE_WORKER_TOKEN=\"${workerToken}\"`,
      '# Optional fallback only:',
      '# supabase secrets set GEMINI_API_KEY="<key>"',
    ].join('\n');

    const modelSetup = [
      'cd cloudflare/social-job-parser',
      `printf '\n[vars]\nPARSER_MODEL = \"${parserModel}\"\n' >> wrangler.toml`,
      'wrangler deploy',
    ].join('\n');

    const smokeTestWorker = [
      `curl -X POST \"${workerUrl}\" \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Authorization: Bearer ${workerToken}\" \\\n  -d '{`,
      '    "jobs": [',
      '      {',
      '        "id": "demo-1",',
      '        "title": "Node.js Developer",',
      '        "description": "Need 8+ years Node.js, remote, W2/C2C, H1B transfer okay, $60-$75/hr",',
      '        "location": "New York, NY"',
      '      }',
      '    ]',
      "  }'",
    ].join('\n');

    const smokeTestEdgeFn = [
      'curl -X POST "<SUPABASE_URL>/functions/v1/receive-social-job" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \\\n  -H "Apikey: <SUPABASE_SERVICE_ROLE_KEY>" \\\n  -d "[{\"post_id\":\"demo-post-1\",\"platform\":\"linkedin\",\"post_content\":\"Hiring Node.js Developer C2C remote\"}]"',
    ].join('\n');

    return {
      deployWorker,
      setSupabaseSecrets,
      modelSetup,
      smokeTestWorker,
      smokeTestEdgeFn,
    };
  }, [parserModel, supabaseProjectRef, workerToken, workerUrl]);

  const copyCommand = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(''), 1400);
    } catch {
      setCopiedKey('');
    }
  };

  const onUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError('');

    try {
      const ok = await verifyAdminPassword(password);
      if (!ok) {
        setAuthError('Invalid admin password');
        return;
      }
      sessionStorage.setItem('admin_authed', password);
      setAuthed(true);
    } catch {
      setAuthError('Network error while verifying password');
    } finally {
      setAuthLoading(false);
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <form onSubmit={onUnlock} className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Admin Commands</h1>
          <p className="mt-1 text-sm text-slate-500">Enter admin password to view parsing model setup commands.</p>
          <div className="mt-4 space-y-3">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              autoFocus
            />
            {authError ? <p className="text-sm text-rose-600">{authError}</p> : null}
            <button
              type="submit"
              disabled={authLoading || !password.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {authLoading ? <LogoSpinner size={14} /> : <Lock size={14} />}
              {authLoading ? 'Verifying...' : 'Unlock'}
            </button>
            <Link to="/admin" className="inline-flex w-full items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Back to Admin Dashboard
            </Link>
          </div>
        </form>
      </div>
    );
  }

  const CommandBlock = ({ title, value, keyName }: { title: string; value: string; keyName: string }) => (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <button
          type="button"
          onClick={() => void copyCommand(value, keyName)}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {copiedKey === keyName ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Copy size={12} />}
          {copiedKey === keyName ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{value}</pre>
    </section>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Admin Commands: Parsing Model Setup</h1>
            <p className="mt-1 text-sm text-slate-600">Use these commands to deploy and configure the parsing model pipeline.</p>
          </div>
          <Link to="/admin" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <ArrowLeft size={14} />
            Back to Admin
          </Link>
        </div>

        <section className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Cloudflare Worker URL</span>
            <input
              value={workerUrl}
              onChange={(e) => setWorkerUrl(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Worker Auth Token</span>
            <input
              value={workerToken}
              onChange={(e) => setWorkerToken(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Parser Model</span>
            <input
              value={parserModel}
              onChange={(e) => setParserModel(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Supabase Project Ref</span>
            <input
              value={supabaseProjectRef}
              onChange={(e) => setSupabaseProjectRef(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <CommandBlock title="1) Deploy Worker" value={commands.deployWorker} keyName="deployWorker" />
          <CommandBlock title="2) Configure Supabase Secrets" value={commands.setSupabaseSecrets} keyName="setSupabaseSecrets" />
          <CommandBlock title="3) Set Parser Model Variable" value={commands.modelSetup} keyName="modelSetup" />
          <CommandBlock title="4) Smoke Test Worker Endpoint" value={commands.smokeTestWorker} keyName="smokeTestWorker" />
          <div className="md:col-span-2">
            <CommandBlock title="5) Smoke Test receive-social-job Function" value={commands.smokeTestEdgeFn} keyName="smokeTestEdgeFn" />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <p className="font-semibold inline-flex items-center gap-2"><Terminal size={14} />n8n / webhook reroute note</p>
          <p className="mt-1">
            Keep the webhook target as receive-social-job. Parsing shifts automatically to Cloudflare when CLOUDFLARE_WORKER_URL is set.
          </p>
        </div>
      </div>
    </div>
  );
}
