// Rush 360° du champion d'un produit : même recette (lumière, fond, caméra), le produit tourne sur lui-même.
// Usage : npm run turntable -- <jobId> [images=120] [samples=64]
// Sortie : ~/.night-studio/rushes/turntable_<slug>.mp4 (1080×1350) et turntable_<slug>_16x9.mp4 (1920×1080)
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { champion, db } from "../src/studio/db.ts";
import { STUDIO_DIR } from "../src/studio/paths.ts";
import { resolveForRender, type Recipe } from "../src/studio/recipe.ts";
import { render } from "../src/studio/render.ts";

const jobId = Number(process.argv[2]);
const frames = Number(process.argv[3] ?? 120);
const samples = Number(process.argv[4] ?? 64);
const job = db.prepare("SELECT id, name, model FROM jobs WHERE id = ?").get(jobId) as { id: number; name: string; model: string } | undefined;
const champ = job && champion(job.id);
if (!job || !champ) {
  console.error("Usage : npm run turntable -- <jobId> (produit avec au moins un champion)");
  process.exit(1);
}

const slug = job.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const dir = join(STUDIO_DIR, "rushes", "_turntable", slug);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const recipe: Recipe & { turntable_frames: number } = { ...(JSON.parse(champ.recipe) as Recipe), samples, turntable_frames: frames };
console.log(`▶ ${job.name} : 360° du champion #${champ.id} (${champ.score}/100), ${frames} images, ${samples} échantillons…`);
const t0 = Date.now();
const rep = await render(await resolveForRender(recipe), job.model, join(dir, "frame.png"), frames * 60_000);
if (!rep.ok) {
  console.error("Rendu en échec :", rep.error);
  process.exit(1);
}
console.log(`  rendu en ${Math.round((Date.now() - t0) / 1000)} s`);

const out = join(STUDIO_DIR, "rushes", `turntable_${slug}.mp4`);
const ffmpeg = (args: string[]) => spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
ffmpeg(["-framerate", "30", "-i", join(dir, "frame_%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", out]);
ffmpeg(["-i", out, "-vf", "scale=-2:1080,pad=1920:1080:(ow-iw)/2:0:color=0x0c0e0b", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", out.replace(".mp4", "_16x9.mp4")]);
rmSync(dir, { recursive: true, force: true });
console.log(`✓ ${out}`);
