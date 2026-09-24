// OneSignal's web push worker.
//
// Deliberately NOT at the site root. A service worker registered at scope "/"
// replaces whichever worker already holds that scope, and /sw.js holds it —
// the one that makes the app installable and keeps old code-split chunks
// alive across a deploy. Putting this one in its own directory gives it the
// narrow scope /push/onesignal/, so the two coexist instead of evicting each
// other. src/lib/onesignal.ts must keep pointing here.
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
