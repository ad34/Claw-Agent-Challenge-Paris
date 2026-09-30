// Lance Blender en arrière-plan pour un rendu. Un crash Blender ne coûte qu'un rendu, jamais l'agent.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BLENDER, STUDIO_DIR } from "./paths.ts";
import type { Recipe } from "./recipe.ts";

const SCRIPT = new URL("../../blender/render.py", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

export async function render(recipe: Recipe, model: string, out: string, timeoutMs = 300_000) {
  mkdirSync(dirname(out), { recursive: true });
  const recipePath = out.replace(/\.png$/, ".recipe.json");
  writeFileSync(recipePath, JSON.stringify({ ...recipe, model, output: out }, null, 1));

  await new Promise<void>((resolve) => {
    const p = spawn(BLENDER, ["-b", "--factory-startup", "-P", SCRIPT, "--", recipePath], { stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    p.on("error", () => resolve());
  });

  const reportPath = out.replace(/\.png$/, ".json");
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : { ok: false, error: "Blender n'a produit aucun rapport (timeout ou crash)" };
  // En mode 360°, les images sont numérotées (frame_0000.png…) au lieu d'un fichier unique.
  const expected = report.frames ? out.replace(/\.png$/, "_0000.png") : out;
  if (report.ok && !report.export_only && !existsSync(expected)) return { ok: false, error: "image absente", seconds: report.seconds };
  return report as { ok: boolean; error?: string; seconds?: number; product_dims?: number[] };
}

export const renderPath = (jobId: number, renderId: number) => join(STUDIO_DIR, "renders", `job${jobId}`, `r${String(renderId).padStart(5, "0")}.png`);
