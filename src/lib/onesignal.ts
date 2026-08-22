import { Capacitor } from '@capacitor/core';
import OneSignal from 'onesignal-cordova-plugin';

const ONESIGNAL_APP_ID = 'fbf333e8-0931-4545-ac03-c532cc07d225';
const PERMISSION_REQUESTED_KEY = 'onesignal_permission_requested';

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

export function initializeOneSignal(): void {
  if (oneSignalInitialized || !Capacitor.isNativePlatform()) {
    return;
  }

  OneSignal.initialize(ONESIGNAL_APP_ID);
  registerPushSubscriptionObserver();
  registerNotificationClickListener();

  oneSignalInitialized = true;
  applyPendingIdentity();
}

export function setOneSignalExternalUserId(externalId: string | null | undefined): void {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  pendingExternalId = externalId ?? null;

  if (oneSignalInitialized) {
    applyPendingIdentity();
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
