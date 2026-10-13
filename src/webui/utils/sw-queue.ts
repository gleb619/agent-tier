import type { CreateRunInput } from "$types/api";

const DB_NAME = "at-sw-queue";
const DB_VERSION = 1;
const STORE_NAME = "requests";

export interface QueuedRun {
  id: string;
  url: string;
  body: CreateRunInput;
  createdAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

export async function queueRun(request: Request): Promise<QueuedRun> {
  const body = (await request.json()) as CreateRunInput;
  const entry: QueuedRun = {
    id: crypto.randomUUID(),
    url: request.url,
    body,
    createdAt: Date.now(),
  };
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = withStore(db, "readwrite");
    const put = store.put(entry);
    put.onsuccess = () => resolve(entry);
    put.onerror = () => reject(put.error);
  });
}

export async function drainQueue(send: (body: CreateRunInput) => Promise<Response>): Promise<QueuedRun[]> {
  const db = await openDB();
  const entries = await new Promise<QueuedRun[]>((resolve, reject) => {
    const request = withStore(db, "readonly").getAll();
    request.onsuccess = () => resolve(request.result as QueuedRun[]);
    request.onerror = () => reject(request.error);
  });

  const replayed: QueuedRun[] = [];
  for (const entry of entries) {
    try {
      const response = await send(entry.body);
      if (response.ok) {
        await deleteQueued(entry.id);
        replayed.push(entry);
      }
    } catch {
      // keep in queue for next attempt
    }
  }
  return replayed;
}

export async function deleteQueued(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = withStore(db, "readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
