// The ProfilePush Apply Chrome extension (extension/ in this repo).
export const EXTENSION_ID = 'bmafklabjfahaillaeemjfokdmangkhj';
// Its Chrome Web Store page, once it's published (until then, /extension).
export const CHROME_STORE_URL: string | null = null;

type ChromeRuntime = { sendMessage: (id: string, msg: unknown, reply: (res: unknown) => void) => void; lastError?: unknown };
const runtime = () => (window as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;

// Sends a message to the extension; resolves null when it isn't installed.
export function toExtension<T = { ok?: boolean }>(msg: Record<string, unknown>): Promise<T | null> {
  const rt = runtime();
  if (!rt?.sendMessage) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      rt.sendMessage(EXTENSION_ID, msg, (res) => resolve(rt.lastError ? null : (res as T) ?? null));
    } catch {
      resolve(null);
    }
    setTimeout(() => resolve(null), 1500);
  });
}
