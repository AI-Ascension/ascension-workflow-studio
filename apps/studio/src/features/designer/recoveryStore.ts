import { isQuotaError, pruneRecords, RecoveryQuotaError, type RecoveryRecord } from "@studio/document";

const DB_NAME = "ascension-studio-recovery";
const STORE = "records";

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB request failed"));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is unavailable in this browser context.");
  }
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "key" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("IndexedDB open failed"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, mode);
    const result = await work(transaction.objectStore(STORE));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    });
    return result;
  } finally {
    database.close();
  }
}

export interface RecoveryPutResult {
  prunedForQuota: boolean;
}

/**
 * Bounded IndexedDB recovery store for sanitized authoring data only. When the
 * storage quota is hit it drops older records and keeps the newest candidate,
 * surfacing the pruning so the UI can say the buffer is full.
 */
export class IndexedDbRecoveryStore {
  public async list(): Promise<RecoveryRecord[]> {
    const records = await withStore("readonly", (store) => request(store.getAll() as IDBRequest<RecoveryRecord[]>));
    return pruneRecords(records);
  }

  public async put(record: RecoveryRecord): Promise<RecoveryPutResult> {
    const existing = (await this.list()).filter((candidate) => candidate.key !== record.key);
    try {
      await this.replaceAll(pruneRecords([...existing, record]));
      return { prunedForQuota: false };
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      await this.replaceAll([record]).catch(() => { throw new RecoveryQuotaError(); });
      return { prunedForQuota: true };
    }
  }

  public async clear(): Promise<void> {
    await withStore("readwrite", (store) => request(store.clear()));
  }

  private async replaceAll(records: RecoveryRecord[]): Promise<void> {
    await withStore("readwrite", async (store) => {
      await request(store.clear());
      for (const record of records) await request(store.put(record));
    });
  }
}
