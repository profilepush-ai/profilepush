import { useEffect } from 'react';
import { CheckCircle, AlertCircle, X } from 'lucide-react';

interface ToastProps {
  message: string;
  type?: 'success' | 'error';
  onClose: () => void;
}

export default function Toast({ message, type = 'success', onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex items-center gap-3 bg-gray-900 text-white px-4 py-3 rounded-lg shadow-xl text-sm max-w-sm animate-slide-up">
      {type === 'success' ? (
        <CheckCircle size={16} className="text-green-400 shrink-0" />
      ) : (
        <AlertCircle size={16} className="text-red-400 shrink-0" />
      )}
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="text-gray-400 hover:text-white shrink-0">
        <X size={14} />
      </button>
    </div>
  );
}
