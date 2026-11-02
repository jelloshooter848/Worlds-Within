/** localStorage wrapper that never throws (private mode, quota, disabled storage). */
export function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Whether `key` is known to hold nothing: false when something is stored there, and false too
 * when storage cannot be read (so a refused erase is never taken for a done one).
 */
export function keyAbsent(key: string): boolean {
  try {
    return localStorage.getItem(key) === null;
  } catch {
    return false;
  }
}

/** Whether anything is stored under `key` (false when storage is unavailable). */
export function hasKey(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/**
 * v0.4.73 (item 69): whether storage can be read at all (false when getItem throws, or there
 * is no storage). A read that throws looks like an empty key to loadJson and hasKey, so a writer
 * that must never put a run over a file it cannot see asks this first.
 */
export function storageReadable(): boolean {
  try {
    localStorage.getItem('worlds-within-probe');
    return true;
  } catch {
    return false;
  }
}
