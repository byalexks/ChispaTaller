/**
 * PIN throttling stored on the device.
 * Four wrong attempts lock that identity for a minute.
 * This is not real security (the PIN lives in the browser), it just stops
 * someone tapping randomly on a shared phone.
 */

const MAX_ATTEMPTS = 4;
const LOCK_MS = 60_000;

const keyAttempts = (identity: string) => `auth:attempts:${identity}`;
const keyUntil = (identity: string) => `auth:until:${identity}`;

export function lockRemaining(identity: string): number {
  const until = Number(localStorage.getItem(keyUntil(identity)) ?? 0);
  return Math.max(0, until - Date.now());
}

export function attemptsLeft(identity: string): number {
  const used = Number(localStorage.getItem(keyAttempts(identity)) ?? 0);
  return Math.max(0, MAX_ATTEMPTS - used);
}

/** Registers a wrong PIN. Returns the lock timestamp when it just got locked, else 0. */
export function registerFailure(identity: string): number {
  const used = Number(localStorage.getItem(keyAttempts(identity)) ?? 0) + 1;

  // Four attempts are allowed; the fifth one locks it.
  if (used > MAX_ATTEMPTS) {
    const until = Date.now() + LOCK_MS;
    localStorage.setItem(keyUntil(identity), String(until));
    localStorage.setItem(keyAttempts(identity), "0");
    return until;
  }

  localStorage.setItem(keyAttempts(identity), String(used));
  return 0;
}

export function clearFailures(identity: string): void {
  localStorage.removeItem(keyAttempts(identity));
  localStorage.removeItem(keyUntil(identity));
}
