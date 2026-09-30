export const API = (import.meta.env.VITE_API as string | undefined) ?? "http://localhost:8787";

export interface JobSummary {
  id: number;
  name: string;
  brief: string;
  renders: number;
  generation: number | null;
  champion_id: number | null;
  champion_score: number | null;
}

export interface State {
  now: string;
  runningSince: string | null;
  current: { jobId: number; name: string; since: string } | null;
  renders: number;
  failed: number;
  gpuSeconds: number;
  champions: number;
  reactions: number;
  nvidia?: { rpm: number; cap: number; limit: number };
  jobs: JobSummary[];
}

export interface Critique {
  score: number;
  scores: Record<string, number>;
  issues: string[];
  suggestions: string[];
  one_liner: string;
}

export interface Render {
  id: number;
  job_id: number;
  generation: number;
  ts: string;
  hypothesis: string | null;
  score: number | null;
  seconds: number;
  champion: 0 | 1;
  critique: string | null;
  recipe: string;
  feedback: string | null; // JSON: [{label, note, ts}]
}

export interface Feedback {
  label: string;
  note: string | null;
  ts: string;
}

export const parseFeedback = (r: Render): Feedback[] => (r.feedback ? (JSON.parse(r.feedback) as Feedback[]).filter((f) => f.label) : []);

export async function sendFeedback(renderId: number, label: string | null, note: string | null) {
  const res = await fetch(`${API}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ renderId, label, note }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
}

export interface AgentEvent {
  id: number;
  ts: string;
  type: string;
  job_id: number | null;
  render_id: number | null;
  message: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

export const fetchState = () => get<State>("/api/state");
export const fetchRenders = (job: number) => get<Render[]>(`/api/renders?job=${job}`);
export const fetchEvents = (after: number) => get<AgentEvent[]>(`/api/events?after=${after}&limit=200`);
export const imageUrl = (id: number, w?: number) => `${API}/api/image/${id}${w ? `?w=${w}` : ""}`;

export interface Intake {
  id: number;
  ts: string;
  source: "telegram" | "ui";
  kind: "photo" | "prompt";
  has_photo: number;
  caption: string | null;
  name: string | null;
  brief: string | null;
  status: "reading" | "modeling" | "done" | "failed";
  progress: number;
  job_id: number | null;
  error: string | null;
}

export const fetchIntakes = () => get<Intake[]>("/api/intakes");
export const intakePhotoUrl = (id: number) => `${API}/api/intake-photo/${id}`;

export interface ExportStatus {
  renderId: number;
  status: "none" | "running" | "done" | "failed";
  startedAt?: string;
  seconds?: number;
  files?: { png: string; glb: string | null; blend: string | null };
  sizes?: Record<string, number>;
  error?: string;
}

export const fetchExport = (id: number) => get<ExportStatus>(`/api/export/${id}`);
export const startExport = (id: number) => fetch(`${API}/api/export/${id}`, { method: "POST" }).then((r) => r.json() as Promise<ExportStatus>);
export const revealExport = (id: number) => fetch(`${API}/api/export/${id}/reveal`, { method: "POST" });
export const exportFileUrl = (id: number, kind: "png" | "glb" | "blend") => `${API}/api/export-file/${id}/${kind}`;

// Viewer 3D : GLB exporté à la demande par Blender + description de l'éclairage de la recette.
export interface ModelScene {
  hdri: string | null;
  hdri_strength: number;
  hdri_rotation_deg: number;
  world_color: string;
  exposure: number;
  background: { type: string; color: string; roughness?: number };
  camera: { azimuth: number; elevation: number; focal_mm: number; fill?: number; look_offset_z?: number };
  lights: { type: string; azimuth: number; elevation: number; power: number; size?: number; color?: string; distance?: number }[];
}
interface ModelStatus {
  status: "none" | "running" | "done" | "failed";
  error?: string;
  size?: number;
  scene: ModelScene;
}
export const modelFileUrl = (id: number) => `${API}/api/model-file/${id}`;
export const hdriUrl = (key: string) => `${API}/api/hdri/${key}`;
export async function ensureModel(id: number, alive: () => boolean): Promise<ModelScene> {
  let s = (await fetch(`${API}/api/model/${id}`, { method: "POST" }).then((r) => r.json())) as ModelStatus;
  while (s.status === "running" && alive()) {
    await new Promise((r) => setTimeout(r, 700));
    s = await get<ModelStatus>(`/api/model/${id}`);
  }
  if (s.status === "failed") throw new Error(s.error ?? "GLB export failed");
  return s.scene;
}

export const retryIntake = (id: number) => fetch(`${API}/api/intake/${id}/retry`, { method: "POST" });

export async function createFromPrompt(prompt: string) {
  const res = await fetch(`${API}/api/intake-prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
}
export const removeJob = (id: number) => fetch(`${API}/api/job/${id}`, { method: "DELETE" });
export const dismissIntake = (id: number) => fetch(`${API}/api/intake/${id}`, { method: "DELETE" });

export async function uploadPhoto(file: File, caption: string) {
  const res = await fetch(`${API}/api/intake`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream", "X-Caption": encodeURIComponent(caption) },
    body: file,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
}

export const parseCritique = (r: Render): Critique | null => (r.critique ? JSON.parse(r.critique) : null);
export const strategyOf = (r: Render) => r.hypothesis?.match(/^\[(\w+)\]/)?.[1] ?? "starter";
export const hypothesisText = (r: Render) => (r.hypothesis ?? "").replace(/^\[\w+\]\s*/, "");
