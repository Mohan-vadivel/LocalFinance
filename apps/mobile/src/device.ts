import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/**
 * Choices kept on this phone only (in the same secure store as the login tokens), not on the server: they belong to
 * the device, not the account.
 */
const KEY = { lock: 'lf.biometricLock', printAsk: 'lf.printAfterCollection' };

type Listener = () => void;
const listeners = new Set<Listener>();
export const onDevicePrefs = (l: Listener) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

async function readFlag(key: string) {
  try {
    return (await SecureStore.getItemAsync(key)) === '1';
  } catch {
    return false;
  }
}
async function writeFlag(key: string, on: boolean) {
  if (on) await SecureStore.setItemAsync(key, '1');
  else await SecureStore.deleteItemAsync(key);
  listeners.forEach((l) => l());
}

/** Fingerprint / face unlock on opening the app. */
export const getBiometricLock = () => readFlag(KEY.lock);
export const setBiometricLock = (on: boolean) => writeFlag(KEY.lock, on);

/** "Receipt printer: ask to print after each collection". */
export const getPrintAsk = () => readFlag(KEY.printAsk);
export const setPrintAsk = (on: boolean) => writeFlag(KEY.printAsk, on);

/** True when the phone has a fingerprint or face reader with at least one enrolled. */
export async function biometricReady() {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

/**
 * Asks for the fingerprint or face, with the phone's own PIN, pattern or password as the fallback. This only unlocks
 * a session that is already logged in; it never stands in for the password login.
 */
export async function askBiometric(prompt: string, cancel: string) {
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: cancel, disableDeviceFallback: false });
    return r.success;
  } catch {
    return false;
  }
}

/** How long the app may sit in the background before it asks again. */
export const LOCK_AFTER_MS = 3 * 60_000;
