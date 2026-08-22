import { Link } from 'react-router-dom';
import { CreditCard, X } from 'lucide-react';

export default function InsufficientCreditsModal({
  open, onClose, balance, actionLabel,
}: {
  open: boolean;
  onClose: () => void;
  balance: number;
  actionLabel: string;
}) {
  if (!open) return null;
  const wholeBalance = Math.floor(Math.max(0, balance));

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xs overflow-hidden rounded-2xl bg-white shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          <X size={15} />
        </button>
        <div className="px-6 pb-6 pt-7 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
            <CreditCard size={20} />
          </span>
          <p className="mt-3 text-[15px] font-semibold text-gray-900">You're out of credits</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500">
            You need 1 credit to {actionLabel}, and you have {wholeBalance} left.
          </p>
          <Link
            to="/billing"
            onClick={onClose}
            className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-blue-600 px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Buy more credits
          </Link>
        </div>
      </div>
    </div>
  );
}
