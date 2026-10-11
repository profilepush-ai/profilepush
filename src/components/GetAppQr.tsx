import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import QRCode from 'qrcode';
import { QrCode } from 'lucide-react';
import { loadMyReferral } from '../lib/referral';
import { PLAY_URL } from '../lib/rate';
import { trackEvent } from '../lib/track';

// The Android app, from a computer: a code to scan with the phone that opens
// ProfilePush on Google Play, tagged with the user's referral code (Play
// passes it on as the install referrer) so the install is theirs.

let cachedCode: Promise<string | null> | null = null;
const myCode = () => (cachedCode ??= loadMyReferral().then((r) => r?.code ?? null).catch(() => null));

function playLinkFor(code: string | null, source: string) {
  const referrer = new URLSearchParams({ utm_source: source, utm_medium: 'qr', utm_campaign: 'get_app', ...(code ? { ref: code } : {}) }).toString();
  return `${PLAY_URL}&referrer=${encodeURIComponent(referrer)}`;
}

// The code itself, the ProfilePush mark in its middle.
export function PlayQr({ size = 168, source = 'desktop_qr' }: { size?: number; source?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void myCode().then((code) => QRCode.toString(playLinkFor(code, source), {
      type: 'svg', errorCorrectionLevel: 'H', margin: 1, color: { dark: '#0B1A3A', light: '#ffffff' },
    })).then((s) => { if (alive) setSvg(s); }).catch(() => {});
    return () => { alive = false; };
  }, [source]);
  return (
    <span className="relative inline-block shrink-0 rounded-xl bg-white p-1.5 ring-1 ring-gray-200" style={{ width: size, height: size }}>
      {svg ? <span className="block h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        : <span className="block h-full w-full animate-pulse rounded-lg bg-gray-100" />}
      <span className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-lg bg-white p-1" style={{ width: size * 0.22, height: size * 0.22 }} aria-hidden="true">
        <svg viewBox="0 0 26 24" className="h-full w-full">
          <circle cx="5" cy="7.6" r="3.6" fill="#FACC15" /><circle cx="5" cy="16.4" r="3.6" fill="#F97316" />
          <polyline points="13,4.5 20,12 13,19.5" fill="none" stroke="#2563EB" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </span>
  );
}

// The header's "Get the app": the code opens on hover or click. Computers only.
export default function GetAppQr() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (Capacitor.isNativePlatform()) return null;
  return (
    <span ref={wrap} className="relative hidden lg:inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" onClick={() => { setOpen((o) => !o); trackEvent('get_app_qr_opened'); }} aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-gray-900 px-3 text-[12.5px] font-bold text-white hover:bg-gray-800">
        <QrCode size={14} />Get the app
      </button>
      {/* On the page itself: the header's blur would clip it. */}
      {open && createPortal(
        <span ref={panel} role="dialog" aria-label="Get the Android app" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} className="fixed right-4 top-14 z-[95] flex w-[250px] flex-col items-center gap-2.5 rounded-2xl bg-white p-4 text-center shadow-2xl ring-1 ring-black/5">
          <PlayQr size={180} />
          <b className="text-[14.5px] font-extrabold text-[#0B1A3A]">Scan to get the app</b>
          <span className="text-[12px] leading-snug text-gray-500">Point your phone&apos;s camera here to open ProfilePush on Google Play. Matches and alerts on the go.</span>
        </span>,
        document.body,
      )}
    </span>
  );
}
