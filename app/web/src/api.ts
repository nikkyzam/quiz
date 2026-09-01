/* Thin API client. Cookies carry the session, so every call sends credentials. */

async function call<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch("/api" + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error || "request_failed", res.status);
  return body as T;
}

export class ApiError extends Error {
  status: number;
  constructor(code: string, status: number) { super(code); this.status = status; }
}

const post = <T,>(p: string, body?: unknown) =>
  call<T>(p, { method: "POST", body: JSON.stringify(body ?? {}) });

export type User = { id: string; email: string; name: string };
export type Learner = { id: string; name: string; beast: string; stars?: number; topics?: number };
export type Topic = { id: string; name: string };
export type Unit = { name: string; track?: string; topics: Topic[] };
export type Grade = { label: string; beast: string; units: Unit[] };
export type Tier = { id: string; name: string; blurb: string };
export type Question = {
  id: string; sec: string; secName: string; type: "mc" | "in" | "pair";
  q: string; opts?: string[]; mono: boolean; hint: string | null; fig: any;
};
export type ProgressRow = {
  topic_id: string; tier: string; best_score: number; best_total: number;
  best_pct: number; runs: number; last_at: string;
};

export const api = {
  me:       () => call<{ user: User | null }>("/auth/me"),
  login:    (email: string, password: string) => post<{ user: User }>("/auth/login", { email, password }),
  register: (email: string, password: string, name: string) =>
              post<{ user: User }>("/auth/register", { email, password, name }),
  logout:   () => post<{ ok: true }>("/auth/logout"),

  learners:     () => call<{ learners: Learner[] }>("/learners"),
  addLearner:   (name: string, beast: string) => post<{ learner: Learner }>("/learners", { name, beast }),
  delLearner:   (id: string) => call<{ deleted: number }>(`/learners/${id}`, { method: "DELETE" }),

  curriculum: () => call<{
    curriculum: Record<string, Grade>;
    tiers: Tier[];
    counts: Record<string, Record<string, number>>;
  }>("/curriculum"),

  questions: (topicId: string, tier: string) =>
    call<{ questions: Question[] }>(`/topics/${topicId}/${tier}/questions`),

  answer: (questionId: string, answer: unknown) =>
    post<{ correct: boolean; correctAnswer: string; explanation: string; figA: any }>(
      "/answer", { questionId, answer }),

  hint: (questionId: string, level: number) =>
    post<{ level: number; hint: string; last: boolean }>("/hint", { questionId, level }),

  saveRun: (learnerId: string, topicId: string, tier: string, score: number, total: number) =>
    post<{ pct: number; star: boolean }>("/runs", { learnerId, topicId, tier, score, total }),

  progress: (learnerId: string) =>
    call<{ progress: ProgressRow[]; recent: any[] }>(`/learners/${learnerId}/progress`)
};
