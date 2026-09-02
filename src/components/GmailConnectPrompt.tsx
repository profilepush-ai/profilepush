import { Mail, X, Send, ShieldCheck, EyeOff } from 'lucide-react';
import LogoSpinner from './LogoSpinner';

const REASSURANCES = [
  { icon: Send, text: 'Send-only access — we can\'t read your inbox' },
  { icon: ShieldCheck, text: '100% private — your Gmail data is never stored or shared' },
  { icon: EyeOff, text: 'We never see your replies — they stay in your Gmail' },
];

export default function GmailConnectPrompt({ connecting, onClose, onConnect }: {
  connecting: boolean;
  onClose: () => void;
  onConnect: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xs overflow-hidden rounded-2xl bg-white shadow-2xl">
        <button onClick={onClose} className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
          <X size={15} />
        </button>
        <div className="px-6 pb-6 pt-6">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Mail size={20} />
          </div>
          <h2 className="text-sm font-semibold text-gray-900">Connect Gmail to send from your own address</h2>
          <ul className="mt-3 space-y-2">
            {REASSURANCES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2 text-xs leading-relaxed text-gray-600">
                <Icon size={13} className="mt-0.5 shrink-0 text-blue-600" />
                {text}
              </li>
            ))}
          </ul>
          <button
            onClick={onConnect}
            disabled={connecting}
            className="mt-5 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {connecting ? <LogoSpinner size={14} /> : <Mail size={13} />}
            {connecting ? 'Redirecting to Google...' : 'Connect Gmail'}
          </button>
        </div>
      </div>
    </div>
  );
}
