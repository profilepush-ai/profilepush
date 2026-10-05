import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import { updateNotifications, type MyWebsite } from '../../lib/website-checkout';

// Who gets an email for each enquiry and the daily report. An empty list
// means everyone on the account.

export default function WebsiteNotifications({ site, onSaved }: { site: MyWebsite; onSaved: () => void }) {
  const [emails, setEmails] = useState<string[]>(site.notify_emails ?? []);
  const [draft, setDraft] = useState('');
  const [daily, setDaily] = useState(site.daily_report);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function add() {
    const parts = draft.split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
    const bad = parts.find(e => !/^\S+@\S+\.\S+$/.test(e));
    if (bad) { setMsg({ ok: false, text: `"${bad}" is not a valid email address.` }); return; }
    setEmails(prev => Array.from(new Set([...prev, ...parts])).slice(0, 10));
    setDraft('');
    setMsg(null);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await updateNotifications(site.id, emails, daily);
      setMsg({ ok: true, text: 'Saved.' });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not save. Please try again.' });
    }
    setSaving(false);
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-5 max-w-2xl">
      <div>
        <p className="text-[13px] font-semibold text-gray-900 flex items-center gap-2"><Bell size={14} className="text-blue-600" /> Enquiry alerts</p>
        <p className="text-xs text-gray-500 mt-1">Each new enquiry is emailed to these addresses. Leave empty to email everyone on your ProfilePush account.</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {emails.map(e => (
            <span key={e} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 pl-3 pr-1.5 py-1 text-[13px] text-gray-800">
              {e}
              <button onClick={() => setEmails(prev => prev.filter(x => x !== e))} aria-label={`Remove ${e}`} className="p-0.5 rounded-full hover:bg-gray-200"><X size={12} /></button>
            </span>
          ))}
          {emails.length === 0 && <span className="text-[13px] text-gray-400">Everyone on the account</span>}
        </div>
        <div className="flex gap-2 mt-3">
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder="name@company.com"
            type="email"
            className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 outline-none"
          />
          <button onClick={add} disabled={!draft.trim() || emails.length >= 10} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:border-gray-300 disabled:opacity-50">Add</button>
        </div>
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={daily} onChange={e => setDaily(e.target.checked)} className="mt-1 h-4 w-4 accent-blue-600" />
        <span>
          <span className="block text-[13px] font-semibold text-gray-900">Daily analytics email</span>
          <span className="block text-xs text-gray-500">Yesterday's visitors, enquiries and traffic sources, sent each morning to the same addresses. Skipped on days with no activity.</span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
