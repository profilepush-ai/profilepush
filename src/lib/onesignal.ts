import { Capacitor } from '@capacitor/core';
import OneSignal from 'onesignal-cordova-plugin';

const ONESIGNAL_APP_ID = 'fbf333e8-0931-4545-ac03-c532cc07d225';
const PERMISSION_REQUESTED_KEY = 'onesignal_permission_requested';

// The web SDK, for browsers and the installed desktop app.
//
// The native half below has always worked; the web half did not exist, so
// every branch here used to return early unless Capacitor said native. The
// server side is shared and already built — a trigger on notifications calls
// send-push-notification, which queues through the Cloudflare worker to
// OneSignal, addressed by external_id. That external_id is the Supabase user
// id, so the only thing a browser has to do is subscribe and log in under the
// same id.
const ONESIGNAL_WEB_SDK_URL = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
// Scoped to its own directory so OneSignal's worker cannot take over the
// scope held by /sw.js. See public/push/onesignal/OneSignalSDKWorker.js.
const ONESIGNAL_WORKER_PATH = 'push/onesignal/OneSignalSDKWorker.js';
const ONESIGNAL_WORKER_SCOPE = '/push/onesignal/';

type OneSignalWeb = {
  init: (options: Record<string, unknown>) => Promise<void>;
  login: (externalId: string) => Promise<void>;
  logout: () => Promise<void>;
  Notifications: {
    permission: boolean;
    requestPermission: () => Promise<void>;
    addEventListener: (event: 'click', handler: (event: unknown) => void) => void;
  };
};

declare global {
  interface Window {
    OneSignalDeferred?: Array<(instance: OneSignalWeb) => void | Promise<void>>;
  }
}

let webSdkRequested = false;

/** Queues work for the web SDK, loading it on first use. */
function withWebOneSignal(run: (instance: OneSignalWeb) => void | Promise<void>): void {
  if (typeof window === 'undefined') return;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(run);
  if (webSdkRequested) return;
  webSdkRequested = true;
  const script = document.createElement('script');
  script.src = ONESIGNAL_WEB_SDK_URL;
  script.defer = true;
  document.head.appendChild(script);
}

let oneSignalInitialized = false;
let pendingExternalId: string | null = null;
let hasRegisteredSubscriptionObserver = false;
let hasRegisteredNotificationClickListener = false;

type PushSubscriptionChangedState = {
  current: {
    id?: string | null;
  };
};

type NotificationClickEvent = {
  notification?: {
    additionalData?: Record<string, unknown>;
  };
};

function isRealSubscriptionId(subscriptionId: string | null | undefined): boolean {
  return !!subscriptionId && !subscriptionId.startsWith('local-');
}

function hasRequestedPermission(): boolean {
  return window.localStorage.getItem(PERMISSION_REQUESTED_KEY) === '1';
}

function markPermissionRequested(): void {
  window.localStorage.setItem(PERMISSION_REQUESTED_KEY, '1');
}

async function requestPushPermissionOnce(): Promise<void> {
  if (hasRequestedPermission()) {
    return;
  }

  markPermissionRequested();

  try {
    await OneSignal.Notifications.requestPermission(true);
  } catch (error) {
    console.warn('[OneSignal] Permission request failed:', error);
  }
}

async function evaluateSubscriptionId(subscriptionId: string | null | undefined): Promise<void> {
  if (!isRealSubscriptionId(subscriptionId)) {
    return;
  }

  await requestPushPermissionOnce();
}

function registerPushSubscriptionObserver(): void {
  if (hasRegisteredSubscriptionObserver) {
    return;
  }

  OneSignal.User.pushSubscription.addEventListener('change', (state: PushSubscriptionChangedState) => {
    void evaluateSubscriptionId(state.current?.id);
  });
  hasRegisteredSubscriptionObserver = true;

  void OneSignal.User.pushSubscription.getIdAsync()
    .then((subscriptionId) => evaluateSubscriptionId(subscriptionId))
    .catch((error) => {
      console.warn('[OneSignal] Failed to read push subscription id:', error);
    });
}

function registerNotificationClickListener(): void {
  if (hasRegisteredNotificationClickListener) {
    return;
  }

  OneSignal.Notifications.addEventListener('click', (event: NotificationClickEvent) => {
    const link = event.notification?.additionalData?.link;
    if (typeof link === 'string' && link.startsWith('/')) {
      window.location.assign(link);
    }
  });
  hasRegisteredNotificationClickListener = true;
}

function applyPendingIdentity(): void {
  // external_id is what the server addresses a push to, so this is the line
  // that decides whether a queued notification reaches this device at all.
  if (!Capacitor.isNativePlatform()) {
    withWebOneSignal(async (instance) => {
      try {
        if (pendingExternalId) await instance.login(pendingExternalId);
        else await instance.logout();
      } catch (error) {
        console.warn('[OneSignal] Failed to sync web user identity:', error);
      }
    });
    return;
  }

  try {
    if (pendingExternalId) {
      OneSignal.login(pendingExternalId);
    } else {
      OneSignal.logout();
    }
  } catch (error) {
    console.warn('[OneSignal] Failed to sync user identity:', error);
  }
}

function initializeOneSignalWeb(): void {
  withWebOneSignal(async (instance) => {
    await instance.init({
      appId: ONESIGNAL_APP_ID,
      serviceWorkerPath: ONESIGNAL_WORKER_PATH,
      serviceWorkerParam: { scope: ONESIGNAL_WORKER_SCOPE },
      // No prompt on load. A permission request fired at first paint is the
      // one most people refuse, and a refusal is close to permanent — the
      // browser stops asking. requestPushPermissionOnWeb is called once the
      // person is signed in, which is the first moment a notification could
      // mean anything to them.
      autoResubscribe: true,
      promptOptions: { slidedown: { prompts: [] } },
    });

    instance.Notifications.addEventListener('click', (event) => {
      const link = (event as { notification?: { additionalData?: { link?: unknown } } })
        ?.notification?.additionalData?.link;
      if (typeof link === 'string' && link.startsWith('/')) {
        window.location.assign(link);
      }
    });

    oneSignalInitialized = true;
    applyPendingIdentity();
  });
}

export function initializeOneSignal(): void {
  if (oneSignalInitialized) {
    return;
  }

  if (!Capacitor.isNativePlatform()) {
    initializeOneSignalWeb();
    return;
  }

  OneSignal.initialize(ONESIGNAL_APP_ID);
  registerPushSubscriptionObserver();
  registerNotificationClickListener();

  oneSignalInitialized = true;
  applyPendingIdentity();
}

/** Asks for notification permission once, after sign-in. */
function requestPushPermissionOnWeb(): void {
  if (hasRequestedPermission()) return;
  withWebOneSignal(async (instance) => {
    if (instance.Notifications.permission) return;
    if (hasRequestedPermission()) return;
    markPermissionRequested();
    try {
      await instance.Notifications.requestPermission();
    } catch (error) {
      console.warn('[OneSignal] Web permission request failed:', error);
    }
  });
}

export function setOneSignalExternalUserId(externalId: string | null | undefined): void {
  pendingExternalId = externalId ?? null;
  applyPendingIdentity();
  // Signed in is the first point a notification could mean anything, so it is
  // where the browser gets asked. Native asks from its subscription observer.
  if (pendingExternalId && !Capacitor.isNativePlatform()) {
    requestPushPermissionOnWeb();
  }
}

export function setOneSignalEmail(email: string): void {
  if (!oneSignalInitialized || !Capacitor.isNativePlatform()) {
    return;
  }
  OneSignal.User.addEmail(email);
}

export function setOneSignalSmsNumber(number: string): void {
  if (!oneSignalInitialized || !Capacitor.isNativePlatform()) {
    return;
  }
  OneSignal.User.addSms(number);
}

export function setOneSignalTag(key: string, value: string): void {
  if (!oneSignalInitialized || !Capacitor.isNativePlatform()) {
    return;
  }
  OneSignal.User.addTag(key, value);
}
