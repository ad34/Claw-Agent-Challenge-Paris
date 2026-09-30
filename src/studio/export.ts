// Livrables d'un rendu : la même recette relancée en 4K (4:5), le GLB du produit sur son socle, et la scène .blend.
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { db, logEvent } from "./db.ts";
import { STUDIO_DIR } from "./paths.ts";
import { resolveForRender, type Recipe } from "./recipe.ts";
import { render } from "./render.ts";

export const EXPORT_RESOLUTION: [number, number] = [3072, 3840]; // 4:5, 3 840 px sur le grand côté
const EXPORT_SAMPLES = 256;

export interface ExportFiles {
  png: string;
  glb: string | null;
  blend: string | null;
}

export interface ExportStatus {
  renderId: number;
  status: "running" | "done" | "failed";
  startedAt: string;
  seconds?: number;
  files?: ExportFiles;
  sizes?: Record<string, number>;
  error?: string;
}

// Suivi en mémoire des exports (un seul par rendu à la fois).
const exports = new Map<number, ExportStatus>();
export const exportStatus = (renderId: number) => exports.get(renderId) ?? findExisting(renderId);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function paths(renderId: number) {
  const row = db.prepare("SELECT r.id, r.recipe, j.name, j.model FROM renders r JOIN jobs j ON j.id = r.job_id WHERE r.id = ?").get(renderId) as
    | { id: number; recipe: string; name: string; model: string }
    | undefined;
  if (!row) throw new Error("Unknown render");
  const dir = join(STUDIO_DIR, "exports", slug(row.name));
  const stem = join(dir, `${slug(row.name)}_r${renderId}`);
  return { row, dir, png: `${stem}_4k.png`, glb: `${stem}.glb`, blend: `${stem}.blend` };
}

// Export déjà fait lors d'une session précédente : on le retrouve sur le disque.
function findExisting(renderId: number): ExportStatus | undefined {
  try {
    const p = paths(renderId);
    if (!existsSync(p.png)) return undefined;
    const files = { png: p.png, glb: existsSync(p.glb) ? p.glb : null, blend: existsSync(p.blend) ? p.blend : null };
    return { renderId, status: "done", startedAt: statSync(p.png).mtime.toISOString(), files, sizes: sizes(files) };
  } catch {
    return undefined;
  }
}

const sizes = (f: ExportFiles) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v && existsSync(v)).map(([k, v]) => [k, statSync(v as string).size]));

export function startExport(renderId: number): ExportStatus {
  const current = exports.get(renderId);
  if (current?.status === "running") return current;
  const p = paths(renderId);
  const status: ExportStatus = { renderId, status: "running", startedAt: new Date().toISOString() };
  exports.set(renderId, status);
  void run(renderId, p, status);
  return status;
}

async function run(renderId: number, p: ReturnType<typeof paths>, status: ExportStatus) {
  mkdirSync(p.dir, { recursive: true });
  logEvent("export", `Exporting #${renderId} in 4K (${EXPORT_RESOLUTION.join("×")}) with its 3D scene`, { renderId });
  const t0 = Date.now();
  const recipe = { ...(JSON.parse(p.row.recipe) as Recipe), resolution: EXPORT_RESOLUTION, samples: EXPORT_SAMPLES, export: { glb: p.glb, blend: p.blend } };
  const rep = (await render(await resolveForRender(recipe), p.row.model, p.png, 30 * 60_000)) as any;
  status.seconds = Math.round((Date.now() - t0) / 1000);
  if (!rep.ok) {
    status.status = "failed";
    status.error = rep.error ?? "render failed";
    logEvent("error", `Export of #${renderId} failed: ${status.error}`, { renderId });
    return;
  }
  status.files = { png: p.png, glb: rep.glb ?? null, blend: rep.blend ?? null };
  status.sizes = sizes(status.files);
  status.status = "done";
  const missing = [rep.glb_error && "GLB", rep.blend_error && ".blend"].filter(Boolean).join(", ");
  logEvent("export", `Export of #${renderId} ready in ${status.seconds}s: 4K PNG${rep.glb ? " + GLB" : ""}${rep.blend ? " + .blend" : ""}${missing ? ` (${missing} failed)` : ""}`, { renderId });
}

// --- Viewer 3D : GLB seul (produit + socle avec les matériaux de la recette), sans rendu. Quelques secondes.
export interface ModelStatus {
  renderId: number;
  status: "none" | "running" | "done" | "failed";
  error?: string;
  size?: number;
}
const models = new Map<number, ModelStatus>();

export function modelStatus(renderId: number): ModelStatus {
  const m = models.get(renderId);
  if (m?.status === "running") return m; // le GLB peut exister à moitié écrit
  const p = paths(renderId);
  if (existsSync(p.glb)) return { renderId, status: "done", size: statSync(p.glb).size };
  return m ?? { renderId, status: "none" };
}

export const modelFile = (renderId: number) => {
  const p = paths(renderId);
  return existsSync(p.glb) ? p.glb : null;
};

export function startModel(renderId: number): ModelStatus {
  const current = modelStatus(renderId);
  if (current.status === "running" || current.status === "done") return current;
  const p = paths(renderId);
  const status: ModelStatus = { renderId, status: "running" };
  models.set(renderId, status);
  void (async () => {
    mkdirSync(p.dir, { recursive: true });
    const work = join(STUDIO_DIR, "exports", "_model", `r${renderId}.png`);
    const recipe = { ...(JSON.parse(p.row.recipe) as Recipe), export: { glb: p.glb }, export_only: true };
    const rep = (await render(await resolveForRender(recipe), p.row.model, work, 5 * 60_000)) as any;
    if (!rep.ok || !rep.glb) {
      status.status = "failed";
      status.error = rep.glb_error ?? rep.error ?? "GLB export failed";
      logEvent("error", `3D model of #${renderId} failed: ${status.error}`, { renderId });
      return;
    }
    status.status = "done";
    logEvent("export", `3D model of #${renderId} ready for the viewer (${rep.seconds}s)`, { renderId });
  })();
  return status;
}

// Ce dont le viewer a besoin pour reproduire l'éclairage : la recette, sans chemins locaux.
export function sceneOf(renderId: number) {
  const r = JSON.parse(paths(renderId).row.recipe) as Recipe;
  return {
    hdri: r.hdri ?? null,
    hdri_strength: r.hdri_strength ?? 1,
    hdri_rotation_deg: r.hdri_rotation_deg ?? 0,
    world_color: r.world_color ?? "#202020",
    exposure: r.exposure ?? 0,
    background: r.background,
    camera: r.camera,
    lights: r.lights ?? [],
  };
}

export async function exportNow(renderId: number): Promise<ExportStatus> {
  const s = startExport(renderId);
  while (s.status === "running") await new Promise((r) => setTimeout(r, 1000));
  return s;
}
