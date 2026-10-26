/** Minimal IndexedDB store for asset packs: { name, manifest, files: Record<path, Blob> }. */
export interface StoredPack {
  name: string;
  manifest: unknown;
  files: Record<string, Blob>;
  addedAt: number;
}

const DB = 'worlds-within';
const STORE = 'packs';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const packStore = {
  async list(): Promise<StoredPack[]> {
    try {
      return (await tx<StoredPack[]>('readonly', (s) => s.getAll())) ?? [];
    } catch {
      return [];
    }
  },
  async get(name: string): Promise<StoredPack | undefined> {
    try {
      return await tx<StoredPack | undefined>('readonly', (s) => s.get(name));
    } catch {
      return undefined;
    }
  },
  async put(pack: StoredPack): Promise<void> {
    await tx('readwrite', (s) => s.put(pack));
  },
  async remove(name: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(name));
  },
};
