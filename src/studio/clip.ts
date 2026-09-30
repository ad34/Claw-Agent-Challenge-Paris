// Clip héros d'un rendu : la recette du champion, caméra en travelling + orbite, produit qui pivote. MP4 1080×1350.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { db, logEvent } from "./db.ts";
import { STUDIO_DIR } from "./paths.ts";
import { resolveForRender, type Recipe } from "./recipe.ts";
import { render } from "./render.ts";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function clipPath(renderId: number): string | null {
  const row = db.prepare("SELECT j.name FROM renders r JOIN jobs j ON j.id = r.job_id WHERE r.id = ?").get(renderId) as { name: string } | undefined;
  return row ? join(STUDIO_DIR, "exports", slug(row.name), `${slug(row.name)}_r${renderId}_clip.mp4`) : null;
}

export const hasClip = (renderId: number) => {
  const p = clipPath(renderId);
  return !!p && existsSync(p) && statSync(p).size > 0;
};

const running = new Map<number, Promise<string>>();
export const clipRunning = (renderId: number) => running.has(renderId);

// 4 s à 30 i/s par défaut ; 48 échantillons + débruitage suffisent en mouvement.
export function makeClip(renderId: number, opts: { frames?: number; samples?: number } = {}): Promise<string> {
  const existing = running.get(renderId);
  if (existing) return existing;
  const job = (async () => {
    const row = db.prepare("SELECT r.recipe, j.model, j.name FROM renders r JOIN jobs j ON j.id = r.job_id WHERE r.id = ?").get(renderId) as
      | { recipe: string; model: string; name: string }
      | undefined;
    if (!row) throw new Error("Unknown render");
    const out = clipPath(renderId)!;
    const dir = join(STUDIO_DIR, "exports", "_clip", String(renderId));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const frames = opts.frames ?? 120;
    logEvent("clip", `Rendering a ${Math.round(frames / 30)}s hero clip of #${renderId} (camera move) on RTX`, { renderId });
    const t0 = Date.now();
    const recipe = { ...(JSON.parse(row.recipe) as Recipe), samples: opts.samples ?? 48, motion: { frames } };
    const rep = await render(await resolveForRender(recipe), row.model, join(dir, "frame.png"), frames * 60_000);
    if (!rep.ok) throw new Error(rep.error ?? "render failed");
    mkdirSync(join(out, ".."), { recursive: true });
    const ff = spawnSync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-framerate", "30", "-i", join(dir, "frame_%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", out],
      { stdio: "inherit" },
    );
    rmSync(dir, { recursive: true, force: true });
    if (ff.status !== 0) throw new Error("ffmpeg failed");
    logEvent("clip", `Hero clip of #${renderId} ready in ${Math.round((Date.now() - t0) / 1000)}s`, { renderId });
    return out;
  })().finally(() => running.delete(renderId));
  running.set(renderId, job);
  return job;
}
