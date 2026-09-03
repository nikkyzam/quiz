/* Typed API helpers and shared shapes for the teacher and admin consoles.
   Paths are relative to /api; the session cookie carries identity. */
import { useCallback, useEffect, useState } from "react";
import { call, post, put, del, ApiError } from "../api";

/* ---------------- shared ---------------- */
export function explain(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Your session has ended. Please sign in again.";
    if (e.status === 403) return "You do not have permission to do that with this account.";
    if (e.status === 404) return `Not found (${e.message.replace(/_/g, " ")}).`;
    return `Request failed: ${e.message.replace(/_/g, " ")}.`;
  }
  return "Something went wrong. Please try again.";
}

/* Loads once on mount unless seeded (the accessibility render passes seeds
   because effects do not run there). `key` re-creates the loader. */
export function useLoad<T>(fn: () => Promise<T>, seed: T | undefined, key = "") {
  const [data, setData] = useState<T | null>(seed ?? null);
  const [err, setErr] = useState("");
  const [seeded] = useState(seed !== undefined);
  const reload = useCallback(async () => {
    try { setData(await fn()); setErr(""); } catch (e) { setErr(explain(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { if (!seeded) reload(); }, [reload, seeded]);
  return { data, err, setErr, reload, setData };
}

export const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString() : "none");
export const fmtWhen = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : "none");

/* ---------------- teacher shapes ---------------- */
export type ClassRow = { id: string; name: string; joinCode: string; members: number };
export type RosterEntry = {
  id: string; name: string; externalId: string | null; guardianEmail: string | null;
  claimCode: string | null; claimed: boolean; learnerName: string | null;
};
export type AssignmentRow = {
  id: string; class_id?: string; topic_id: string; tier: string | null; due_at: string | null;
  group_id: string | null; created_at?: string;
};
export type LearnerAssignment = {
  assignmentId: string; topicId: string; groupId: string | null; bestPct: number; mastered: boolean; attempted: boolean;
};
export type LearnerProgress = { learnerId: string; name: string; topicsMastered: number; assignments: LearnerAssignment[] };
export type HeatRow = { topicId: string; groupId: string | null; assigned: number; attempted: number; averagePct: number; mastered: number };
export type ProgressData = { class: { id: string; name: string }; assignments: AssignmentRow[]; learners: LearnerProgress[]; heatmap: HeatRow[] };
export type Group = { id: string; name: string; track: string | null; members: { id: string; name: string }[] };
export type TeamMember = { learnerId?: string; name: string; you: boolean; points: number };
export type Team = { id: string; name: string; members: TeamMember[]; points: number; rank?: number };
export type Tournament = { enabled: boolean; reason?: string; week?: { start: string; end: string }; teams?: Team[] };
export type Leaderboard = { enabled: boolean; reason?: string; displayNames?: boolean; board?: { rank: number; points: number; you: boolean; name: string }[] };
export type ContestBoard = { enabled: boolean; reason?: string; format?: string; board?: { rank: number; best: number; papers: number; you: boolean; name: string }[] };
export type ClassSettings = { leaderboardOn: boolean; displayNames: boolean; tournamentOn: boolean };
export type Thresholds = { core: number | null; adv: number | null };
export type Accommodations = { extraTimePct: number; hintsInChecks: boolean; shorterChecks: boolean; readAloud: boolean; notes: string };

export const TRACKS = ["core", "enrichment", "competition"] as const;
export const CONTEST_FORMATS = ["kangaroo", "moems", "amc8", "mathcounts", "drill"] as const;

export const teacherApi = {
  classes: () => call<{ classes: ClassRow[] }>("/classes"),
  createClass: (name: string) => post<{ class: { id: string; name: string; joinCode: string } }>("/classes", { name }),
  roster: (id: string) => call<{ roster: RosterEntry[] }>(`/classes/${id}/roster`),
  importCsv: (id: string, csv: string) =>
    post<{ imported: number; entries: { id: string; name: string; claimCode: string; updated: boolean }[] }>(`/classes/${id}/roster/import`, { csv }),
  importOneRoster: (classes: string, users: string, enrollments: string) =>
    post<{ classes: { classId: string; name: string; students: number }[] }>("/classes/import/oneroster", { classes, users, enrollments }),
  progress: (id: string) => call<ProgressData>(`/classes/${id}/progress`),
  setTrack: (id: string, learnerId: string, track: string) => put<{ track: string }>(`/classes/${id}/learners/${learnerId}/track`, { track }),
  assign: (id: string, body: { topicId: string; tier: string | null; dueAt: string | null; groupId: string | null }) =>
    post<{ assignment: { id: string } }>(`/classes/${id}/assignments`, body),
  groups: (id: string) => call<{ groups: Group[] }>(`/classes/${id}/groups`),
  createGroup: (id: string, name: string, track: string | null) => post<{ group: Group }>(`/classes/${id}/groups`, { name, track }),
  addGroupMember: (id: string, groupId: string, learnerId: string) =>
    post<{ groupId: string; learnerId: string; track: string | null }>(`/classes/${id}/groups/${groupId}/members`, { learnerId }),
  setAccommodations: (id: string, learnerId: string, body: Accommodations) =>
    put<{ accommodations: Accommodations }>(`/classes/${id}/learners/${learnerId}/accommodations`, body),
  setSettings: (id: string, body: ClassSettings) => put<{ settings: ClassSettings }>(`/classes/${id}/settings`, body),
  setThresholds: (id: string, body: Thresholds) => put<{ thresholds: Thresholds }>(`/classes/${id}/thresholds`, body),
  leaderboard: (id: string) => call<Leaderboard>(`/classes/${id}/leaderboard`),
  contest: (id: string, format: string) =>
    call<ContestBoard>(`/classes/${id}/contest-leaderboard${format ? `?format=${encodeURIComponent(format)}` : ""}`),
  teams: (id: string) => call<{ teams: Team[] }>(`/classes/${id}/teams`),
  createTeam: (id: string, name: string) => post<{ team: Team }>(`/classes/${id}/teams`, { name }),
  addTeamMember: (id: string, teamId: string, learnerId: string) =>
    post<{ teamId: string; learnerId: string }>(`/classes/${id}/teams/${teamId}/members`, { learnerId }),
  deleteTeam: (id: string, teamId: string) => del<{ deleted: number }>(`/classes/${id}/teams/${teamId}`),
  tournament: (id: string) => call<Tournament>(`/classes/${id}/tournament`)
};

/* ---------------- admin shapes ---------------- */
export type Overview = {
  users: number; byRole: { role: string; c: number }[]; learners: number; classes: number; runs: number;
  activeLearnersLast7Days: number; attainment: Record<string, number>;
  hardestTopics: { topicId: string; name: string; attempts: number; averagePct: number }[];
};
export type Totals = { teachers: number; classes: number; learners: number; rounds: number };
export type SchoolNode = Totals & { id: string; name: string; districtId: string | null; masteredPct: number | null };
export type Hierarchy = {
  districts: { id: string; name: string; schools: SchoolNode[]; totals: Totals }[];
  unassignedSchools: SchoolNode[]; totals: Totals;
};
export type AdminSettings = { mastery: { core: number; adv: number }; defaults?: { core: number; adv: number }; retentionDays: number | null };
export type Retention = {
  policy: Record<string, string>; oldestRecord: string | null;
  counts: { auditEntries: number; runs: number; mistakes: number };
};
export type AuditEntry = { user_id: string | null; action: string; detail: string | null; at: string };
export type Analytics = { since: string; days: Record<string, Record<string, number>> };
export type Webhook = { id: string; url: string; events: string[]; active: boolean; created_at: string; pending: number; failed: number };
export type Delivery = {
  id: string; event: string; status: string; attempts: number; next_at: string | null;
  last_error: string | null; created_at: string; delivered_at: string | null;
};
export type LtiPlatform = { id: string; issuer: string; client_id: string; name: string; deployment_id: string; created_at: string };
export type OidcProvider = { id: string; name: string; default_role: string; email_domain: string | null };
export type KeyReport = { currentKeyId: string; byKey: Record<string, number>; plaintext: number; rotation: string };
export type BackupResult = { ok: boolean; file?: string; encrypted?: boolean; at?: string; error?: string };

export const adminApi = {
  overview: () => call<Overview>("/admin/overview"),
  hierarchy: () => call<Hierarchy>("/admin/hierarchy"),
  createDistrict: (name: string) => post<{ district: { id: string; name: string } }>("/admin/districts", { name }),
  createSchool: (name: string, districtId: string | null) =>
    post<{ school: { id: string; name: string; districtId: string | null } }>("/admin/schools", { name, districtId }),
  assignUser: (email: string, schoolId: string | null) => put<{ userId: string; schoolId: string | null }>("/admin/users/school", { email, schoolId }),
  settings: () => call<AdminSettings>("/admin/settings"),
  saveSettings: (body: { mastery?: { core: number; adv: number }; retentionDays?: number | null }) => put<AdminSettings>("/admin/settings", body),
  backup: (encrypt: boolean) => post<BackupResult>("/admin/backup", { encrypt }),
  retention: () => call<Retention>("/admin/retention"),
  audit: () => call<{ entries: AuditEntry[] }>("/admin/audit"),
  analytics: (days: number) => call<Analytics>(`/admin/analytics?days=${days}`),
  runJob: (job: string) => post<{ job: string; result: unknown }>(`/admin/jobs/${job}`),
  webhookEvents: () => call<{ events: string[] }>("/webhooks/events"),
  webhooks: () => call<{ webhooks: Webhook[] }>("/webhooks"),
  createWebhook: (url: string, events: string[]) =>
    post<{ webhook: { id: string; url: string; events: string[]; secret: string } }>("/webhooks", { url, events }),
  deleteWebhook: (id: string) => del<{ deleted: number }>(`/webhooks/${id}`),
  deliveries: (id: string) => call<{ deliveries: Delivery[] }>(`/webhooks/${id}/deliveries`),
  testWebhook: () => post<{ queued: number }>("/webhooks/test"),
  ltiPlatforms: () => call<{ platforms: LtiPlatform[] }>("/admin/lti/platforms"),
  createLtiPlatform: (body: Record<string, string>) => post<{ platform: { id: string } }>("/admin/lti/platforms", body),
  oidcProviders: () => call<{ providers: OidcProvider[] }>("/auth/oidc/providers"),
  createOidcProvider: (body: Record<string, string>) => post<{ provider: { id: string } }>("/admin/oidc/providers", body),
  oneRosterSync: (body: { baseUrl: string; clientId: string; clientSecret: string; teacherEmail: string }) =>
    post<{ classes: { classId: string; name: string; students: number }[]; pulled: { classes: number; users: number; enrollments: number } }>(
      "/admin/oneroster/sync", body),
  keys: () => call<KeyReport>("/admin/keys")
};
