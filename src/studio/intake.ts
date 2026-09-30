// Entrée d'un produit :
// - par photo (Telegram ou interface) : Nemotron Omni (nom + brief) → Meshy image-to-3D → nouveau job ;
// - par description seule : Nemotron Super (nom + brief + prompt 3D) → Meshy text-to-3D → nouveau job.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { chatJson } from "../llm.ts";
import { visionJson } from "./critic.ts";
import { db, logEvent, now } from "./db.ts";
import { STUDIO_DIR } from "./paths.ts";

const MESHY = "https://api.meshy.ai/openapi/v1/image-to-3d";
const MESHY_TEXT = "https://api.meshy.ai/openapi/v2/text-to-3d";

export interface ProductBrief {
  name: string;
  brief: string;
}

// Nemotron Omni regarde la photo et rédige le brief de shooting (la légende de l'utilisateur prime).
export async function briefFromPhoto(photo: Buffer, caption: string): Promise<ProductBrief> {
  const jpeg = await sharp(photo).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const content = [
    {
      type: "text",
      text:
        `A small online brand sent this photo of a product they sell. ${caption ? `Their note: '${caption}'. ` : ""}` +
        `Write a short product name (max 5 words) and a one-paragraph brief for its hero e-commerce photo: ` +
        `who buys it, the mood, what the image must make desirable (materials, shape, details). ` +
        `Never use double quotes inside values. Answer ONLY JSON: {"name":"...","brief":"..."}`,
    },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
  ];
  // Relances avec attente incluses (endpoint partagé, parfois saturé).
  const out = await visionJson<ProductBrief>(content, 400);
  return { name: String(out.name).slice(0, 60), brief: String(out.brief).slice(0, 600) };
}

// Si Nemotron Omni reste indisponible, le produit ne doit pas être perdu : brief minimal tiré de la note.
function fallbackBrief(caption: string): ProductBrief {
  const name = caption ? caption.split(/[,.]/)[0].trim().split(/\s+/).slice(0, 5).join(" ") : "New product";
  return {
    name: name.charAt(0).toUpperCase() + name.slice(1),
    brief: caption
      ? `Hero e-commerce image. Brand note: ${caption}. Make the product desirable: clear shape, convincing materials, on-brand mood.`
      : "Hero e-commerce image for an online shop. Clean, premium, desirable: clear shape, convincing materials, soft studio light.",
  };
}

// Photo → modèle 3D texturé (GLB) via Meshy. Renvoie le chemin local du GLB.
export async function meshyFromPhoto(photo: Buffer, onProgress?: (p: number) => void): Promise<string> {
  const key = process.env.MESHY_API_KEY;
  if (!key) throw new Error("MESHY_API_KEY manquante dans .env");
  const auth = { Authorization: `Bearer ${key}` };
  const png = await sharp(photo).resize({ width: 1024, withoutEnlargement: true }).png().toBuffer();

  const create = await fetch(MESHY, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: `data:image/png;base64,${png.toString("base64")}`,
      enable_pbr: true,
      should_remesh: true,
      should_texture: true,
      topology: "triangle",
      target_polycount: 60000,
    }),
  });
  if (!create.ok) throw new Error(`Meshy HTTP ${create.status}: ${(await create.text()).slice(0, 300)}`);
  const taskId = ((await create.json()) as { result: string }).result;

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const t = (await (await fetch(`${MESHY}/${taskId}`, { headers: auth })).json()) as any;
    onProgress?.(t.progress ?? 0);
    if (t.status === "SUCCEEDED") {
      const glb = await fetch(t.model_urls.glb);
      const dir = join(STUDIO_DIR, "assets", "meshy");
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${taskId}.glb`);
      writeFileSync(path, Buffer.from(await glb.arrayBuffer()));
      return path;
    }
    if (t.status === "FAILED" || t.status === "CANCELED") throw new Error(`Meshy : ${t.task_error?.message ?? t.status}`);
  }
  throw new Error("Meshy : délai dépassé (20 min)");
}

// Description seule : Nemotron Super écrit le brief et un prompt de modélisation 3D (un objet seul, sans décor).
export interface ProductConcept extends ProductBrief {
  model_prompt: string;
}
export async function conceptFromPrompt(prompt: string): Promise<ProductConcept> {
  const out = await chatJson<ProductConcept>(
    [
      {
        role: "system",
        content:
          "You turn a small brand's product description into a studio brief. Answer ONLY JSON: " +
          '{"name": short product name (max 5 words), "brief": one paragraph for its hero e-commerce photo (who buys it, mood, what must look desirable), ' +
          '"model_prompt": a precise description for a text-to-3D generator of the product ALONE (shape, proportions, materials, colors, surface details; no scene, no background, no text or logos, max 60 words)}',
      },
      { role: "user", content: prompt },
    ],
    { maxTokens: 700, json: true },
  );
  return { name: String(out.name).slice(0, 60), brief: String(out.brief).slice(0, 600), model_prompt: String(out.model_prompt || prompt).slice(0, 700) };
}

// Texte → modèle 3D texturé (GLB) via Meshy : ébauche (preview) puis texture PBR (refine).
// La progression va de 0 à 50 pour l'ébauche, de 50 à 100 pour la texture. `onThumb` reçoit l'aperçu dès qu'il existe.
export async function meshyFromText(prompt: string, onProgress?: (p: number) => void, onThumb?: (url: string) => void): Promise<string> {
  const key = process.env.MESHY_API_KEY;
  if (!key) throw new Error("MESHY_API_KEY missing in .env");
  const auth = { Authorization: `Bearer ${key}` };
  const post = async (body: unknown) => {
    const res = await fetch(MESHY_TEXT, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Meshy HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return ((await res.json()) as { result: string }).result;
  };
  const wait = async (id: string, from: number) => {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 10_000));
      const t = (await (await fetch(`${MESHY_TEXT}/${id}`, { headers: auth })).json()) as any;
      onProgress?.(Math.round(from + (t.progress ?? 0) / 2));
      if (t.status === "SUCCEEDED") return t;
      if (t.status === "FAILED" || t.status === "CANCELED") throw new Error(`Meshy: ${t.task_error?.message ?? t.status}`);
    }
    throw new Error("Meshy: timed out (20 min)");
  };
  const previewId = await post({ mode: "preview", prompt, should_remesh: true, topology: "triangle", target_polycount: 60000 });
  const preview = await wait(previewId, 0);
  if (preview.thumbnail_url) onThumb?.(preview.thumbnail_url);
  const refineId = await post({ mode: "refine", preview_task_id: previewId, enable_pbr: true, texture_prompt: prompt.slice(0, 800) });
  const done = await wait(refineId, 50);
  if (done.thumbnail_url) onThumb?.(done.thumbnail_url);
  const glb = await fetch(done.model_urls.glb);
  const dir = join(STUDIO_DIR, "assets", "meshy");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${refineId}.glb`);
  writeFileSync(path, Buffer.from(await glb.arrayBuffer()));
  return path;
}

export interface IntakeHooks {
  onBrief?: (b: ProductBrief) => Promise<void> | void;
  onDone?: (jobId: number, b: ProductBrief) => Promise<void> | void;
  onError?: (err: Error) => Promise<void> | void;
}

// Flux complet commun à Telegram et à l'interface. Chaque étape est visible dans la table `intakes`.
export async function runIntake(photo: Buffer, caption: string, source: "telegram" | "ui", hooks: IntakeHooks = {}): Promise<number> {
  const dir = join(STUDIO_DIR, "assets", "photos");
  mkdirSync(dir, { recursive: true });
  const photoPath = join(dir, `${Date.now()}.jpg`);
  await sharp(photo).rotate().jpeg({ quality: 92 }).toFile(photoPath);
  const { lastInsertRowid } = db
    .prepare("INSERT INTO intakes(ts, source, photo, caption, status) VALUES(?, ?, ?, ?, 'reading')")
    .run(now(), source, photoPath, caption || null);
  return processIntake(Number(lastInsertRowid), photo, caption, photoPath, hooks);
}

// Relance d'une arrivée en échec, à partir de la photo déjà enregistrée.
export async function retryIntake(id: number): Promise<number> {
  const row = db.prepare("SELECT photo, caption, kind FROM intakes WHERE id = ? AND status = 'failed'").get(id) as
    | { photo: string; caption: string | null; kind: string }
    | undefined;
  if (!row) throw new Error("nothing to retry");
  db.prepare("UPDATE intakes SET status = 'reading', progress = 0, error = NULL WHERE id = ?").run(id);
  if (row.kind === "prompt") return processPromptIntake(id, row.caption ?? "");
  return processIntake(id, readFileSync(row.photo), row.caption ?? "", row.photo, {});
}

// Produit décrit en quelques mots, sans photo.
export async function runPromptIntake(prompt: string, source: "telegram" | "ui"): Promise<number> {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO intakes(ts, source, photo, caption, status, kind) VALUES(?, ?, '', ?, 'reading', 'prompt')")
    .run(now(), source, prompt);
  return processPromptIntake(Number(lastInsertRowid), prompt);
}

async function processPromptIntake(id: number, prompt: string): Promise<number> {
  const set = (fields: Record<string, unknown>) => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE intakes SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...(Object.values(fields) as any[]), id);
  };
  try {
    let concept: ProductConcept;
    try {
      concept = await conceptFromPrompt(prompt);
    } catch (err) {
      concept = { ...fallbackBrief(prompt), model_prompt: prompt };
      logEvent("error", `Nemotron Super unavailable for the brief (${(err as Error).message.slice(0, 80)}), using the description as is`);
    }
    set({ name: concept.name, brief: concept.brief, status: "modeling" });
    logEvent("intake", `New product from a description: ${concept.name}. Nemotron Super wrote the brief, Meshy is generating the 3D model`, {
      payload: { concept, intake: id },
    });
    const dir = join(STUDIO_DIR, "assets", "photos");
    mkdirSync(dir, { recursive: true });
    const thumbPath = join(dir, `prompt-${id}.jpg`);
    const model = await meshyFromText(
      concept.model_prompt,
      (p) => set({ progress: p }),
      (url) =>
        void fetch(url)
          .then((r) => r.arrayBuffer())
          .then((b) => sharp(Buffer.from(b)).flatten({ background: "#1a1c18" }).jpeg({ quality: 88 }).toBuffer())
          .then((jpg) => {
            // Écriture atomique : l'interface peut lire la miniature au même moment.
            writeFileSync(`${thumbPath}.tmp`, jpg);
            renameSync(`${thumbPath}.tmp`, thumbPath);
            set({ photo: thumbPath });
          })
          .catch(() => {}),
    );
    const jobId = addJob(concept.name, model, concept.brief);
    set({ status: "done", progress: 100, job_id: jobId });
    return jobId;
  } catch (err) {
    set({ status: "failed", error: (err as Error).message.slice(0, 400) });
    logEvent("error", `Product intake failed: ${(err as Error).message}`, { payload: { intake: id } });
    throw err;
  }
}

// Produit raté (modèle 3D inutilisable…) : retiré de la liste de shooting. Rien n'est effacé du disque.
export function removeJob(id: number) {
  const row = db.prepare("SELECT name FROM jobs WHERE id = ? AND active = 1").get(id) as { name: string } | undefined;
  if (!row) throw new Error("Unknown product");
  db.prepare("UPDATE jobs SET active = 0 WHERE id = ?").run(id);
  logEvent("job", `Removed from the shoot list: ${row.name}`, { jobId: id });
}

// Carte d'arrivée terminée ou en échec : on la masque.
export function dismissIntake(id: number) {
  db.prepare("DELETE FROM intakes WHERE id = ? AND status IN ('failed', 'done')").run(id);
}

async function processIntake(id: number, photo: Buffer, caption: string, photoPath: string, hooks: IntakeHooks): Promise<number> {
  const set = (fields: Record<string, unknown>) => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE intakes SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...(Object.values(fields) as any[]), id);
  };
  try {
    let brief: ProductBrief;
    try {
      brief = await briefFromPhoto(photo, caption);
    } catch (err) {
      brief = fallbackBrief(caption);
      logEvent("error", `Nemotron Omni unavailable for the brief (${(err as Error).message.slice(0, 80)}), using the brand note instead`);
    }
    set({ name: brief.name, brief: brief.brief, status: "modeling" });
    logEvent("intake", `Photo received: ${brief.name}. Nemotron Omni wrote the brief, Meshy is building the 3D model`, { payload: { brief, intake: id } });
    await hooks.onBrief?.(brief);
    const model = await meshyFromPhoto(photo, (p) => set({ progress: p }));
    const jobId = addJob(brief.name, model, brief.brief, photoPath);
    set({ status: "done", progress: 100, job_id: jobId });
    await hooks.onDone?.(jobId, brief);
    return jobId;
  } catch (err) {
    set({ status: "failed", error: (err as Error).message.slice(0, 400) });
    logEvent("error", `Photo intake failed: ${(err as Error).message}`, { payload: { intake: id } });
    await hooks.onError?.(err as Error);
    throw err;
  }
}

export function addJob(name: string, model: string, brief: string, sourcePhoto?: string): number {
  const { lastInsertRowid } = db.prepare("INSERT INTO jobs(name, model, brief, created_at) VALUES(?, ?, ?, ?)").run(name, model, brief, now());
  const id = Number(lastInsertRowid);
  logEvent("job", `New product on the shoot list: ${name}`, { jobId: id, payload: { sourcePhoto } });
  return id;
}
