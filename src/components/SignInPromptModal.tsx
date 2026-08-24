import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import GoogleSignInButton from './GoogleSignInButton';

const isNativeApp = Capacitor.isNativePlatform();

export default function SignInPromptModal({
  open,
  onClose,
  onSuccess,
  message = 'Sign in to download the full list.',
  signInPath = '/signin',
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  message?: string;
  signInPath?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <X size={15} />
        </button>
        <div className="px-6 pb-7 pt-8 text-center">
          <p className="text-[15px] font-semibold text-gray-900">{message}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500">It's free — takes about 10 seconds.</p>

          {!isNativeApp && (
            <div className="mt-6">
              <GoogleSignInButton onSuccess={onSuccess} />
            </div>
          )}
          <p className="mt-5 text-[12px] text-gray-400">
            or <Link to={signInPath} onClick={onClose} className="font-semibold text-blue-600 hover:underline">sign in with email</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
