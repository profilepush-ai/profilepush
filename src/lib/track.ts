import { supabase } from './supabase';

// Records a product event (see the product_events migration). Fire and forget:
// tracking must never slow down or break the action it describes.
export function trackEvent(event: string, props: Record<string, unknown> = {}): void {
  try {
    void supabase.rpc('track_event' as never, {
      p_event: event,
      p_props: props,
      p_path: typeof window !== 'undefined' ? window.location.pathname : null,
    } as never).then(() => undefined, () => undefined);
  } catch {
    // ignore
  }
}
