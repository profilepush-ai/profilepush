// capacitor-razorpay's bundled output assumes it's loaded as a <script> tag
// inside a real Capacitor WebView (references a free `capacitorExports`
// global) and isn't safe to import in Node/jsdom. Capacitor.isNativePlatform()
// is always false in tests, so the real plugin never actually needs to run —
// this stub just satisfies the import.
export const Checkout = {
  open: async () => ({ response: '{}' }),
};
