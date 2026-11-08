// Phone notifications on this device (Nov 7, 2026). The browser makes a private push address
// for this phone; Backlot's server keeps it and sends a few words when something needs you.
// iPhones only allow this once Backlot is on the Home Screen, and only from a tap.

import { bil } from './team';

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const what = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : 'Browser';
  return `${what}${isStandalone() ? ' app' : ' browser'}`;
}

/** This device's push address, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/**
 * Turns notifications on for this device. Must be called straight from a tap: the permission
 * prompt is asked first, before anything else waits.
 */
export async function turnOn(): Promise<void> {
  if (!pushSupported()) throw new Error(isIos() && !isStandalone() ? 'Add Backlot to your Home Screen first, then open it from there.' : 'This browser cannot show notifications.');
  const asked = Notification.requestPermission();
  const [permission, key] = await Promise.all([asked, bil.pushKey()]);
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications are blocked for Backlot. Allow them in your phone or browser settings, then try again.' : 'Notifications were not turned on.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.publicKey) });
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error('This browser gave an incomplete push address. Try again.');
  await bil.pushSubscribe({ endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth }, label: deviceLabel(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
}

/** Turns notifications off for this device only. */
export async function turnOff(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await bil.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}
