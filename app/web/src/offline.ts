/* Offline practice and sync (spec 10.6).

   A learner can save a tier's questions while online ("pack"), play the
   round with no connection, and have the answers checked by the server
   when the device is back online. Grading never happens on the device: the
   correct answers are not in the pack, so a saved pack cannot be mined.

   Storage is IndexedDB with a localStorage fallback for browsers that block
   it (private mode, kiosk profiles). Every read and write is wrapped so a
   storage failure degrades to "nothing saved" rather than a crash. */
import { useEffect, useState } from "react";
import { call, post, type Question } from "./api";

export type OfflineQuestion = Omit<Question, "type"> & {
  type: Question["type"] | "plot"; grid?: { min: number; max: number };
};
export type Pack = { key: string; topicId: string; tier: string; questions: OfflineQuestion[]; savedAt: string };
export type PackMeta = Omit<Pack, "questions"> & { count: number };
export type OfflineRun = {
  clientId: string; learnerId: string; topicId: string; tier: string;
  answers: Record<string, unknown>; total: number; seconds: number; finishedAt: string;
};
export type SyncResult = {
  clientId: string; duplicate?: boolean; error?: string;
  score?: number; total?: number; pct?: number;
  detail?: { id: string; correct: boolean; correctAnswer?: string; explanation?: string }[];
};

export const packKey = (topicId: string, tier: string) => `${topicId}/${tier}`;
export const isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/* ---------- key/value storage ---------- */
type Store = "packs" | "runs";
const DB_NAME = "mathquest-offline", DB_VERSION = 1, STORES: Store[] = ["packs", "runs"];
let dbp: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

function idb<T>(store: Store, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then(db => {
    if (!db) return undefined;
    return new Promise<T | undefined>(resolve => {
      try {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
        t.onerror = () => resolve(undefined);
      } catch { resolve(undefined); }
    });
  });
}

/* localStorage fallback: one JSON map per store. */
const lsKey = (store: Store) => `mq-offline:${store}`;
function lsRead(store: Store): Record<string, unknown> {
  try { return JSON.parse(localStorage.getItem(lsKey(store)) || "{}") || {}; } catch { return {}; }
}
function lsWrite(store: Store, map: Record<string, unknown>) {
  try { localStorage.setItem(lsKey(store), JSON.stringify(map)); } catch {}
}

async function kvGet<T>(store: Store, key: string): Promise<T | undefined> {
  const db = await openDb();
  if (db) return idb<T>(store, "readonly", s => s.get(key) as IDBRequest<T>);
  return lsRead(store)[key] as T | undefined;
}
async function kvAll<T>(store: Store): Promise<T[]> {
  const db = await openDb();
  if (db) return (await idb<T[]>(store, "readonly", s => s.getAll() as IDBRequest<T[]>)) || [];
  return Object.values(lsRead(store)) as T[];
}
async function kvSet(store: Store, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (db) { await idb(store, "readwrite", s => s.put(value, key)); return; }
  const m = lsRead(store); m[key] = value; lsWrite(store, m);
}
async function kvDel(store: Store, key: string): Promise<void> {
  const db = await openDb();
  if (db) { await idb(store, "readwrite", s => s.delete(key)); return; }
  const m = lsRead(store); delete m[key]; lsWrite(store, m);
}

/* ---------- change notifications ---------- */
const subs = new Set<() => void>();
const notify = () => subs.forEach(fn => { try { fn(); } catch {} });
export function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

/* ---------- packs ---------- */
export async function downloadPack(topicId: string, tier: string): Promise<PackMeta> {
  const r = await call<{ questions: OfflineQuestion[] }>(`/topics/${topicId}/${tier}/questions`);
  const pack: Pack = { key: packKey(topicId, tier), topicId, tier, questions: r.questions, savedAt: new Date().toISOString() };
  await kvSet("packs", pack.key, pack);
  notify();
  return { key: pack.key, topicId, tier, savedAt: pack.savedAt, count: pack.questions.length };
}
export async function loadPack(topicId: string, tier: string): Promise<Pack | null> {
  const p = await kvGet<Pack>("packs", packKey(topicId, tier));
  return p && Array.isArray(p.questions) && p.questions.length ? p : null;
}
export const hasPack = async (topicId: string, tier: string) => !!(await loadPack(topicId, tier));
export async function listPacks(): Promise<PackMeta[]> {
  const all = await kvAll<Pack>("packs");
  return all.map(p => ({ key: p.key, topicId: p.topicId, tier: p.tier, savedAt: p.savedAt, count: p.questions?.length || 0 }));
}
export async function removePack(topicId: string, tier: string): Promise<void> {
  await kvDel("packs", packKey(topicId, tier));
  notify();
}

/* ---------- queued runs ---------- */
const newClientId = () => {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID(); } catch {}
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
};

export async function queueRun(run: Omit<OfflineRun, "clientId"> & { clientId?: string }): Promise<OfflineRun> {
  const full: OfflineRun = { ...run, clientId: run.clientId || newClientId() };
  await kvSet("runs", full.clientId, full);
  notify();
  return full;
}
export async function pendingRuns(): Promise<OfflineRun[]> { return kvAll<OfflineRun>("runs"); }
export const pendingCount = async () => (await pendingRuns()).length;

/* POST /sync: one request per learner, batches of at most 50. A batch the
   server answers (accepted, duplicate, or rejected as malformed) leaves the
   queue; a request that never reaches the server keeps everything for the
   next attempt. Concurrent callers share one in-flight sync. */
let inFlight: Promise<{ synced: number; failed: number; results: SyncResult[] }> | null = null;
export function syncPending(): Promise<{ synced: number; failed: number; results: SyncResult[] }> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const out = { synced: 0, failed: 0, results: [] as SyncResult[] };
    if (!isOnline()) return out;
    const runs = await pendingRuns();
    if (!runs.length) return out;
    const byLearner = new Map<string, OfflineRun[]>();
    for (const r of runs) byLearner.set(r.learnerId, [...(byLearner.get(r.learnerId) || []), r]);
    for (const [learnerId, list] of byLearner) {
      for (let i = 0; i < list.length; i += 50) {
        const batches = list.slice(i, i + 50).map(r => ({
          clientId: r.clientId, topicId: r.topicId, answers: r.answers,
          seconds: r.seconds, finishedAt: r.finishedAt
        }));
        let results: SyncResult[];
        try { results = (await post<{ results: SyncResult[] }>("/sync", { learnerId, batches })).results || []; }
        catch { out.failed += batches.length; continue; }
        for (const res of results) {
          if (!res.clientId) continue;
          await kvDel("runs", res.clientId);
          if (res.error) out.failed++; else out.synced++;
          out.results.push(res);
        }
      }
    }
    if (out.synced || out.failed) notify();
    return out;
  })().finally(() => { inFlight = null; });
  return inFlight;
}

/* Sync as soon as the connection comes back. */
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { syncPending().catch(() => {}); });
}

/* ---------- hooks ---------- */
export function useOnline(): boolean {
  const [on, setOn] = useState(isOnline());
  useEffect(() => {
    const up = () => setOn(isOnline());
    window.addEventListener("online", up);
    window.addEventListener("offline", up);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", up); };
  }, []);
  return on;
}

export function usePendingCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const refresh = () => { pendingCount().then(setN).catch(() => {}); };
    refresh();
    return subscribe(refresh);
  }, []);
  return n;
}
