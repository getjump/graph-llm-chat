import { useEffect } from 'react';
import { useStore } from '../../store';

const AUTO_DISMISS_MS = 4000;

export function ToastContainer() {
  const toasts = useStore((state) => state.toasts);
  const removeToast = useStore((state) => state.removeToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => removeToast(toast.id), AUTO_DISMISS_MS)
    );
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [toasts, removeToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          data-testid="toast"
          className={`w-80 rounded-lg border px-4 py-3 shadow-lg ${
            toast.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200'
              : toast.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-200'
                : 'border-gray-200 bg-white text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{toast.title}</div>
              {toast.message && (
                <div className="text-xs mt-1 leading-snug">{toast.message}</div>
              )}
            </div>
            <button
              type="button"
              data-testid="toast-close"
              onClick={() => removeToast(toast.id)}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              Close
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
