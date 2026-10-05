import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Copy, Globe, RefreshCw } from 'lucide-react';
import { domainAction, SITE_BASE_URL, type DomainState, type MyWebsite } from '../../lib/website-checkout';

// Connect the customer's own domain. They add a CNAME (plus TXT records
// Cloudflare asks for) at their DNS provider; HTTPS is issued automatically.

export default function WebsiteDomain({ site, onChanged }: { site: MyWebsite; onChanged: () => void }) {
  const [state, setState] = useState<DomainState | null>(null);
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!site.custom_domain) { setState({ domain: null, status: null, records: [] }); return; }
    setBusy(true);
    try {
      const s = await domainAction('status', site.id);
      setState(s);
      if (s.status !== site.domain_status) onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the domain.');
    }
    setBusy(false);
  }, [site.id, site.custom_domain, site.domain_status, onChanged]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function run(action: 'connect' | 'remove') {
    setBusy(true);
    setError(null);
    try {
      const s = await domainAction(action, site.id, action === 'connect' ? domain : undefined);
      setState(action === 'remove' ? { domain: null, status: null, records: [] } : s);
      setDomain('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
    setBusy(false);
  }

  function copy(v: string) {
    void navigator.clipboard?.writeText(v);
    setCopied(v);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-4 max-w-3xl">
      <div>
        <p className="text-[13px] font-semibold text-gray-900 flex items-center gap-2"><Globe size={14} className="text-blue-600" /> Your domain</p>
        <p className="text-xs text-gray-500 mt-1">
          Your website is always at <a href={`${SITE_BASE_URL}/${site.slug}/`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{SITE_BASE_URL.replace('https://', '')}/{site.slug}</a>.
          Connect your own domain and it serves the same site, with HTTPS included. Prefer us to do it? Email poorna@profilepush.ai.
        </p>
      </div>

      {state?.domain ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-gray-900">{state.domain}</span>
            {state.status === 'active' && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5"><CheckCircle size={12} /> Live with HTTPS</span>}
            {state.status === 'pending' && <span className="text-xs font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">Waiting for DNS</span>}
            {state.status === 'failed' && <span className="text-xs font-semibold text-red-700 bg-red-50 rounded-full px-2 py-0.5">Needs attention</span>}
            <button onClick={refresh} disabled={busy} className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"><RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Check now</button>
            <button onClick={() => run('remove')} disabled={busy} className="text-xs text-red-600 hover:underline ml-auto">Disconnect</button>
          </div>
          {state.records.length > 0 && (
            <>
              <p className="text-xs text-gray-600">Add these records at your domain provider (GoDaddy, Namecheap, Google Domains…). Changes usually take a few minutes, sometimes up to a few hours.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="text-left text-gray-500"><th className="py-1.5 pr-3 font-medium">Type</th><th className="py-1.5 pr-3 font-medium">Name</th><th className="py-1.5 font-medium">Value</th></tr></thead>
                  <tbody>
                    {state.records.map(r => (
                      <tr key={`${r.type}${r.name}`} className="border-t border-gray-100 align-top">
                        <td className="py-2 pr-3 font-semibold">{r.type}</td>
                        <td className="py-2 pr-3 break-all">{r.name}</td>
                        <td className="py-2">
                          <button onClick={() => copy(r.value)} className="inline-flex items-start gap-1.5 text-left break-all hover:text-blue-600">
                            <span>{r.value}</span>{copied === r.value ? <CheckCircle size={13} className="shrink-0 mt-0.5 text-emerald-600" /> : <Copy size={13} className="shrink-0 mt-0.5 text-gray-400" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500">Root domains (yourcompany.com without www) need a provider that supports CNAME flattening or ALIAS records. Using www.yourcompany.com works everywhere; ask your provider to forward the root to www.</p>
            </>
          )}
          {state.errors && state.errors.length > 0 && <p className="text-xs text-red-600">{state.errors.join(' ')}</p>}
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            value={domain}
            onChange={e => setDomain(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && domain.trim()) void run('connect'); }}
            placeholder="www.yourcompany.com"
            className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
          />
          <button onClick={() => run('connect')} disabled={busy || !domain.trim()} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60">
            {busy ? 'Connecting…' : 'Connect domain'}
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
