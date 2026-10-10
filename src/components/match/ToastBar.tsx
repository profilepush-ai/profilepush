import type { Toast } from './useMatchActions';

// The one-line message after an action, with Undo when it can be undone.
export default function ToastBar({ toast, onClose }: { toast: Toast | null; onClose: () => void }) {
  if (!toast) return null;
  return (
    <div role="status" className={`fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-1/2 z-[90] flex max-w-[92vw] -translate-x-1/2 items-center gap-4 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold shadow-xl sm:bottom-6 ${toast.tone === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white dark:bg-slate-100 dark:text-gray-900'}`}>
      <span className="min-w-0">{toast.msg}</span>
      {toast.undo && (
        <button type="button" className="shrink-0 font-extrabold text-blue-300 dark:text-blue-700" onClick={() => { toast.undo?.(); onClose(); }}>Undo</button>
      )}
    </div>
  );
}
