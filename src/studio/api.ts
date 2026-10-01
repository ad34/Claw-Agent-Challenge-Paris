// API locale de l'interface (Tauri ou navigateur) : état, journal, rendus, images,
// plus les actions de la marque (photo produit, retours, exports 4K + 3D). Écoute sur 127.0.0.1 uniquement.
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename } from "node:path";
import sharp from "sharp";
import { NVIDIA_RPM, nvidiaCallsLastMinute } from "../llm.ts";
import { db, getKv } from "./db.ts";
import { HDRI_CHOICES, polyhavenHdri } from "./assets.ts";
import { exportStatus, modelFile, modelStatus, sceneOf, startExport, startModel } from "./export.ts";
import { recordFeedback } from "./feedback.ts";
import { dismissIntake, removeJob, retryIntake, runIntake, runPromptIntake } from "./intake.ts";

const PORT = Number(process.env.API_PORT ?? 8787);
// Visite scriptée de l'interface demandée par `npm run record-ui` (mode démo, pour filmer les rushs).
let tour: { name: string; id: number } | null = null;
// Sous Windows, le cache de libvips garde les fichiers ouverts et empêche de les réécrire (miniatures Meshy) : on le coupe.
sharp.cache(false);

const json: Record<string, (q: URLSearchParams) => unknown> = {
  "/api/state": () => {
    const one = (sql: string, ...a: any[]) => (db.prepare(sql).get(...a) as { n: number }).n;
    const start = db.prepare("SELECT ts FROM events WHERE type = 'agent_start' ORDER BY id LIMIT 1").get() as { ts: string } | undefined;
    return {
      now: new Date().toISOString(),
      runningSince: start?.ts ?? null,
      nvidia: { rpm: nvidiaCallsLastMinute(), cap: NVIDIA_RPM, limit: 40 },
      tour,
      current: JSON.parse(getKv("current") ?? "null"),
      renders: one("SELECT count(*) n FROM renders WHERE error IS NULL"),
      failed: one("SELECT count(*) n FROM renders WHERE error IS NOT NULL"),
      gpuSeconds: (db.prepare("SELECT coalesce(sum(seconds), 0) n FROM renders").get() as { n: number }).n,
      champions: one("SELECT count(*) n FROM renders WHERE champion = 1"),
      reactions: one("SELECT count(*) n FROM picks WHERE label IS NOT NULL"),
      jobs: db
        .prepare(
          `SELECT j.id, j.name, j.brief,
             (SELECT count(*) FROM renders r WHERE r.job_id = j.id AND r.error IS NULL) AS renders,
             (SELECT max(generation) FROM renders r WHERE r.job_id = j.id) AS generation,
             (SELECT id FROM renders r WHERE r.job_id = j.id AND champion = 1 ORDER BY id DESC LIMIT 1) AS champion_id,
             (SELECT score FROM renders r WHERE r.job_id = j.id AND champion = 1 ORDER BY id DESC LIMIT 1) AS champion_score
           FROM jobs j WHERE j.active = 1 ORDER BY j.id`,
        )
        .all(),
    };
  },
  "/api/events": (q) =>
    db
      .prepare("SELECT id, ts, type, job_id, render_id, message FROM events WHERE id > ? ORDER BY id DESC LIMIT ?")
      .all(Number(q.get("after") ?? 0), Math.min(500, Number(q.get("limit") ?? 100))),
  "/api/renders": (q) =>
    db
      .prepare(
        `SELECT r.id, r.job_id, r.generation, r.ts, r.hypothesis, r.score, r.seconds, r.champion, r.critique, r.recipe,
           (SELECT json_group_array(json_object('label', p.label, 'note', p.note, 'ts', p.ts)) FROM picks p
             WHERE p.render_id = r.id AND p.label IS NOT NULL) AS feedback
         FROM renders r WHERE r.job_id = ? AND r.error IS NULL ORDER BY r.id`,
      )
      .all(Number(q.get("job") ?? 1)),
  "/api/intakes": () =>
    db.prepare("SELECT id, ts, source, kind, photo != '' AS has_photo, caption, name, brief, status, progress, job_id, error FROM intakes ORDER BY id DESC LIMIT 10").all(),
  "/api/taste": () => ({ taste: (db.prepare("SELECT payload FROM events WHERE type = 'taste' ORDER BY id DESC LIMIT 1").get() as any)?.payload ?? null }),
};

export function startApi() {
  createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Caption");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    try {
      // Envoi d'une photo produit depuis l'interface : corps brut (image), légende dans X-Caption (encodée URI).
      if (req.method === "POST" && url.pathname === "/api/intake") {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > 25 * 1024 * 1024) return void res.writeHead(413).end(JSON.stringify({ error: "Image too large (25 MB max)" }));
          chunks.push(c as Buffer);
        }
        const photo = Buffer.concat(chunks);
        await sharp(photo).metadata(); // rejette tout ce qui n'est pas une image lisible
        const caption = decodeURIComponent(String(req.headers["x-caption"] ?? ""));
        void runIntake(photo, caption, "ui").catch(() => {}); // suivi via /api/intakes
        return void res.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      }
      const tourReq = url.pathname.match(/^\/api\/tour\/(\w+)$/);
      if (req.method === "POST" && tourReq) {
        tour = { name: tourReq[1], id: Date.now() };
        return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(tour));
      }
      // Produit décrit sans photo : { prompt }.
      if (req.method === "POST" && url.pathname === "/api/intake-prompt") {
        let body = "";
        for await (const c of req) body += c;
        const prompt = String(JSON.parse(body || "{}").prompt ?? "").trim().slice(0, 800);
        if (prompt.length < 3) return void res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Describe the product" }));
        void runPromptIntake(prompt, "ui").catch(() => {});
        return void res.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      }
      // Retrait d'un produit raté, ou d'une carte d'arrivée.
      const del = url.pathname.match(/^\/api\/(job|intake)\/(\d+)$/);
      if (req.method === "DELETE" && del) {
        try {
          if (del[1] === "job") removeJob(Number(del[2]));
          else dismissIntake(Number(del[2]));
        } catch (err) {
          return void res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: (err as Error).message }));
        }
        return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      }
      // Retour de la marque sur un rendu : { renderId, label?, note? }.
      if (req.method === "POST" && url.pathname === "/api/feedback") {
        let body = "";
        for await (const c of req) body += c;
        const { renderId, label, note } = JSON.parse(body || "{}");
        try {
          recordFeedback(Number(renderId), label ?? null, note ?? null, "ui");
        } catch (err) {
          return void res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: (err as Error).message }));
        }
        return void res.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      }
      // Livrables 4K + 3D d'un rendu : lancer, suivre, ouvrir le dossier, télécharger.
      const exp = url.pathname.match(/^\/api\/export\/(\d+)(\/reveal)?$/);
      if (exp) {
        const id = Number(exp[1]);
        const json = (code: number, body: unknown) => void res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(body));
        try {
          if (req.method === "POST" && exp[2]) {
            const s = exportStatus(id);
            if (!s?.files) return json(404, { error: "No export yet" });
            spawn("explorer.exe", [`/select,${s.files.png}`], { detached: true, stdio: "ignore" }).unref();
            return json(200, { ok: true });
          }
          if (req.method === "POST") return json(202, startExport(id));
          return json(200, exportStatus(id) ?? { renderId: id, status: "none" });
        } catch (err) {
          return json(400, { error: (err as Error).message });
        }
      }
      // Viewer 3D : GLB du rendu (généré à la demande), description de l'éclairage, HDRI de la recette.
      const model = url.pathname.match(/^\/api\/model\/(\d+)$/);
      if (model) {
        const id = Number(model[1]);
        const body = { ...(req.method === "POST" ? startModel(id) : modelStatus(id)), scene: sceneOf(id) };
        return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
      }
      const modelGlb = url.pathname.match(/^\/api\/model-file\/(\d+)$/);
      if (modelGlb) {
        const file = modelFile(Number(modelGlb[1]));
        if (!file) return void res.writeHead(404).end();
        res.writeHead(200, { "Content-Type": "model/gltf-binary" });
        return void createReadStream(file).pipe(res);
      }
      const hdri = url.pathname.match(/^\/api\/hdri\/(\w+)$/);
      if (hdri) {
        const key = hdri[1] as keyof typeof HDRI_CHOICES;
        if (!(key in HDRI_CHOICES)) return void res.writeHead(404).end();
        const file = await polyhavenHdri(HDRI_CHOICES[key], "1k");
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "max-age=31536000, immutable" });
        return void createReadStream(file).pipe(res);
      }
      const expFile = url.pathname.match(/^\/api\/export-file\/(\d+)\/(png|glb|blend)$/);
      if (expFile) {
        const file = exportStatus(Number(expFile[1]))?.files?.[expFile[2] as "png" | "glb" | "blend"];
        if (!file || !existsSync(file)) return void res.writeHead(404).end();
        res.writeHead(200, {
          "Content-Type": { png: "image/png", glb: "model/gltf-binary", blend: "application/octet-stream" }[expFile[2]]!,
          "Content-Disposition": `attachment; filename="${basename(file)}"`,
        });
        return void createReadStream(file).pipe(res);
      }
      const retry = url.pathname.match(/^\/api\/intake\/(\d+)\/retry$/);
      if (req.method === "POST" && retry) {
        void retryIntake(Number(retry[1])).catch(() => {});
        return void res.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      }
      const intakePhoto = url.pathname.match(/^\/api\/intake-photo\/(\d+)$/);
      if (intakePhoto) {
        const row = db.prepare("SELECT photo FROM intakes WHERE id = ?").get(Number(intakePhoto[1])) as { photo: string } | undefined;
        if (!row || !existsSync(row.photo)) return void res.writeHead(404).end();
        res.writeHead(200, { "Content-Type": "image/jpeg" });
        return void res.end(await sharp(readFileSync(row.photo)).resize({ width: 320 }).jpeg({ quality: 80 }).toBuffer());
      }
      // /api/image/123?w=480 : rendu en JPEG redimensionné (vignettes de la galerie).
      const img = url.pathname.match(/^\/api\/image\/(\d+)$/);
      if (img) {
        const row = db.prepare("SELECT path FROM renders WHERE id = ?").get(Number(img[1])) as { path: string | null } | undefined;
        if (!row?.path || !existsSync(row.path)) return void res.writeHead(404).end();
        const w = Number(url.searchParams.get("w") ?? 0);
        res.writeHead(200, { "Content-Type": w ? "image/jpeg" : "image/png", "Cache-Control": "max-age=31536000, immutable" });
        if (!w) return void createReadStream(row.path).pipe(res);
        return void res.end(await sharp(row.path).resize({ width: Math.min(w, 1080) }).jpeg({ quality: 82 }).toBuffer());
      }
      const handler = json[url.pathname];
      if (!handler) return void res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(handler(url.searchParams)));
    } catch (err) {
      if (!res.headersSent) res.writeHead(500);
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  }).listen(PORT, "127.0.0.1", () => console.log(`API sur http://localhost:${PORT}`));
}
