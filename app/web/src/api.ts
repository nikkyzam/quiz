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
  id: string; sec: string; secName: string;
  type: "mc" | "in" | "pair" | "order" | "multi";
  q: string; opts?: string[]; items?: string[];
  mono: boolean; hint: string | null; fig: any;
};
export type ProgressRow = {
  topic_id: string; tier: string; best_score: number; best_total: number;
  best_pct: number; runs: number; last_at: string;
};

export const api = {
  me:       () => call<{ user: User | null }>("/auth/me"),
  login:    (email: string, password: string) => post<{ user: User }>("/auth/login", { email, password }),
  register: (email: string, password: string, name: string, coppaConsent: boolean) =>
              post<{ user: User }>("/auth/register", { email, password, name, coppaConsent }),

  exportData: () => call<any>("/me/export"),
  auditTrail: () => call<{ entries: any[] }>("/me/audit"),
  deleteAccount: () => call<{ deleted: boolean }>("/me", { method: "DELETE" }),
  logout:   () => post<{ ok: true }>("/auth/logout"),
  forgot:   (email: string) =>
              post<{ ok: true; message: string; token?: string; expiresAt?: string }>("/auth/forgot", { email }),
  resetPassword: (token: string, password: string) =>
              post<{ ok: true; message: string }>("/auth/reset", { token, password }),

  learners:     () => call<{ learners: Learner[] }>("/learners"),
  addLearner:   (name: string, beast: string) => post<{ learner: Learner }>("/learners", { name, beast }),
  delLearner:   (id: string) => call<{ deleted: number }>(`/learners/${id}`, { method: "DELETE" }),

  curriculum: () => call<{
    curriculum: Record<string, Grade>;
    tiers: Tier[];
    counts: Record<string, Record<string, number>>;
    thresholds: Record<string, number>;
    mastery: { core: number; adv: number };
  }>("/curriculum"),

  questions: (topicId: string, tier: string) =>
    call<{ questions: Question[] }>(`/topics/${topicId}/${tier}/questions`),

  answer: (questionId: string, answer: unknown) =>
    post<{ correct: boolean; correctAnswer: string; explanation: string; figA: any }>(
      "/answer", { questionId, answer }),

  hint: (questionId: string, level: number) =>
    post<{ level: number; hint: string; last: boolean }>("/hint", { questionId, level }),

  saveRun: (learnerId: string, topicId: string, tier: string, score: number, total: number) =>
    post<{ pct: number; threshold: number; track: string; star: boolean }>("/runs", { learnerId, topicId, tier, score, total }),

  progress: (learnerId: string) =>
    call<{ progress: ProgressRow[]; recent: any[] }>(`/learners/${learnerId}/progress`),

  /* diagnostic (4.1.1) */
  startDiagnostic: (learnerId: string, topicId: string) =>
    post<{ diagnosticId: string; question: Question; asked: number }>("/diagnostic/start", { learnerId, topicId }),
  answerDiagnostic: (diagnosticId: string, answer: unknown) =>
    post<{ correct: boolean; correctAnswer: string; explanation: string; done: boolean;
           asked?: number; question?: Question; summary?: DiagnosticSummary }>(
      "/diagnostic/answer", { diagnosticId, answer }),
  lastDiagnostic: (learnerId: string) =>
    call<{ diagnostic: (DiagnosticSummary & { finishedAt: string }) | null }>(`/learners/${learnerId}/diagnostic`),

  /* review queue (4.1.7) */
  review: (learnerId: string) =>
    call<{ review: ReviewItem[] }>(`/learners/${learnerId}/review`),

  /* adaptive practice (4.1.4) */
  startPractice: (learnerId: string, topicId: string) =>
    post<{ sessionId: string; length: number; question: Question; asked: number; score: number }>(
      "/practice/start", { learnerId, topicId }),
  answerPractice: (sessionId: string, answer: unknown, hintsUsed: number) =>
    post<{ correct: boolean; correctAnswer: string; explanation: string; figA: any; done: boolean;
           asked?: number; score?: number; question?: Question; summary?: any;
           intervention?: { type: string; message: string; suggest: string } | null }>(
      "/practice/answer", { sessionId, answer, hintsUsed }),

  /* mastery check (4.1.6) */
  startMastery: (learnerId: string, topicId: string) =>
    post<{ checkId: string; threshold: number; questions: Question[] }>("/mastery/start", { learnerId, topicId }),
  submitMastery: (checkId: string, answers: Record<string, unknown>) =>
    post<{ score: number; total: number; pct: number; threshold: number; passed: boolean;
           detail: { id: string; correct: boolean; correctAnswer: string; explanation: string }[] }>(
      "/mastery/submit", { checkId, answers })
};

export type SkillRow = { sec: string; name: string; asked: number; correct: number; pct: number; level: string };
export type DiagnosticSummary = {
  asked: number; correct: number; overall: number; reliable: boolean;
  skillMap: SkillRow[];
  recommendation: { topicId: string; tier: string; focus: string | null; message: string };
};
export type ReviewItem = {
  topicId: string; tier: string; bestPct: number; threshold: number;
  track: string; gap: number; lastAt: string;
};
