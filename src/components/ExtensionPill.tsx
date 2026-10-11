import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Puzzle } from 'lucide-react';
import { CHROME_STORE_URL, toExtension } from '../lib/extension';
import { trackEvent } from '../lib/track';

// The header's ProfilePush Apply pill (computers, Chrome-family browsers):
// "Extension on" when it answers, else "Add to Chrome".
const chromium = () => typeof navigator !== 'undefined' && /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !/Mobile/.test(navigator.userAgent);

export default function ExtensionPill() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (Capacitor.isNativePlatform() || !chromium()) return;
    void toExtension({ type: 'pp-ping' }).then((r) => setOn(Boolean(r?.ok)));
  }, []);
  if (Capacitor.isNativePlatform() || !chromium() || on == null) return null;
  const cls = 'hidden h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-bold lg:inline-flex';
  if (on) {
    return (
      <Link to="/extension" title="ProfilePush Apply is installed" className={`${cls} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100`}>
        <i className="h-2 w-2 rounded-full bg-emerald-500" />Extension on
      </Link>
    );
  }
  const go = () => trackEvent('extension_pill_clicked');
  return CHROME_STORE_URL ? (
    <a href={CHROME_STORE_URL} target="_blank" rel="noreferrer" onClick={go} className={`${cls} bg-white text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50`} title="ProfilePush Apply fills career-site applications for you">
      <Puzzle size={14} className="text-[#2563EB]" />Add to Chrome
    </a>
  ) : (
    <Link to="/extension" onClick={go} className={`${cls} bg-white text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50`} title="ProfilePush Apply fills career-site applications for you">
      <Puzzle size={14} className="text-[#2563EB]" />Add to Chrome
    </Link>
  );
}
