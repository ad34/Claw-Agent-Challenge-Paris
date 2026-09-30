// Rushs vidéo pour le montage (Remotion + voix off ElevenLabs), générés depuis les données du studio.
// Usage : npm run rushes            → tous les produits actifs
//         npm run rushes -- 3       → un produit (id)
// Sortie : ~/.night-studio/rushes/ (1920×1080, 30 i/s, H.264) + manifest.json pour les props Remotion.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { db } from "../src/studio/db.ts";
import { STUDIO_DIR } from "../src/studio/paths.ts";

const W = 1920;
const H = 1080;
const FPS = 30;
const OUT = join(STUDIO_DIR, "rushes");
const BG = "#0c0e0b";
const GREEN = "#76b900";
const FONT = "Segoe UI, Arial, sans-serif";
const MONO = "Consolas, monospace";

type Row = { id: number; generation: number; ts: string; score: number; hypothesis: string | null; critique: string | null; champion: number; path: string; seconds: number };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hyp = (r: Row) => (r.hypothesis ?? "Plain baseline studio setup").replace(/^\[\w+\]\s*/, "");
const strategy = (r: Row) => ({ refine: "Refine", explore: "Explore", taste: "Brand taste" })[r.hypothesis?.match(/^\[(\w+)\]/)?.[1] ?? ""] ?? "Baseline";

function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if ((cur + " " + w).trim().length > max) {
      out.push(cur.trim());
      cur = w;
      if (out.length === lines) break;
    } else cur += " " + w;
  }
  if (out.length < lines && cur.trim()) out.push(cur.trim());
  if (out.length === lines && text.length > out.join(" ").length) out[lines - 1] = out[lines - 1].replace(/\W*\S*$/, "") + "…";
  return out;
}

// Carte 16:9 : rendu à gauche, génération / score / hypothèse à droite.
async function card(r: Row, name: string, firstScore: number, label: string): Promise<Buffer> {
  const ih = 960;
  const iw = Math.round((ih * 4) / 5);
  const img = await sharp(r.path).resize(iw, ih, { fit: "cover" }).toBuffer();
  const x = 140 + iw + 110;
  const gain = r.score - firstScore;
  const lines = wrap(hyp(r), 44, 5);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="${BG}"/>
    <text x="${x}" y="190" font-family="${FONT}" font-size="30" fill="#9ba493">${esc(name)}</text>
    <text x="${x}" y="250" font-family="${MONO}" font-size="30" fill="${GREEN}">${esc(label)} · GENERATION ${r.generation}</text>
    <text x="${x - 6}" y="470" font-family="${MONO}" font-size="220" fill="#e6e9e1">${r.score}</text>
    <text x="${x + 290}" y="470" font-family="${MONO}" font-size="56" fill="#6b7365">/100</text>
    ${gain > 0 ? `<text x="${x}" y="545" font-family="${MONO}" font-size="40" fill="${GREEN}">+${gain} since the first render</text>` : ""}
    <text x="${x}" y="660" font-family="${FONT}" font-size="24" fill="#6b7365">${esc(strategy(r))} · Nemotron Super</text>
    ${lines.map((l, i) => `<text x="${x}" y="${710 + i * 46}" font-family="${FONT}" font-size="34" fill="#c9cfc2">${esc(l)}</text>`).join("")}
    <text x="${x}" y="${H - 70}" font-family="${MONO}" font-size="24" fill="#6b7365">#${r.id} · ${r.seconds}s on RTX 4080 SUPER</text>
  </svg>`;
  return sharp(Buffer.from(svg)).composite([{ input: img, left: 140, top: 60 }]).png().toBuffer();
}

async function blend(a: Buffer, b: Buffer, t: number): Promise<Buffer> {
  const top = await sharp(b).ensureAlpha(t).png().toBuffer();
  return sharp(a).composite([{ input: top }]).png().toBuffer();
}

function encode(frameDir: string, out: string, framerate = FPS) {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(framerate), "-i", join(frameDir, "%05d.png"), "-r", String(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", out], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg a échoué pour ${out}`);
}

function frames(dir: string) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let n = 0;
  return (buf: Buffer) => writeFileSync(join(dir, `${String(n++).padStart(5, "0")}.png`), buf);
}

async function lineageClip(slug: string, name: string, champs: Row[]) {
  const dir = join(OUT, "_frames");
  const put = frames(dir);
  const cards = await Promise.all(champs.map((c, i) => card(c, name, champs[0].score, i === 0 ? "FIRST RENDER" : i === champs.length - 1 ? "CHAMPION" : "NEW CHAMPION")));
  for (let i = 0; i < cards.length; i++) {
    const hold = i === cards.length - 1 ? 75 : 36;
    for (let f = 0; f < hold; f++) put(cards[i]);
    if (i < cards.length - 1) for (let f = 1; f <= 12; f++) put(await blend(cards[i], cards[i + 1], f / 12));
  }
  encode(dir, join(OUT, `lineage_${slug}.mp4`));
}

async function flipbook(slug: string, all: Row[]) {
  const dir = join(OUT, "_frames");
  const put = frames(dir);
  const ih = 1000;
  const iw = Math.round((ih * 4) / 5);
  let best = 0;
  for (const [i, r] of all.entries()) {
    best = Math.max(best, r.champion ? r.score : best);
    const img = await sharp(r.path).resize(iw, ih, { fit: "cover" }).toBuffer();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${BG}"/>
      <text x="80" y="120" font-family="${MONO}" font-size="34" fill="#6b7365">RENDER ${i + 1} / ${all.length}</text>
      <text x="80" y="180" font-family="${MONO}" font-size="34" fill="${r.champion ? GREEN : "#9ba493"}">score ${r.score}${r.champion ? "  ★ champion" : ""}</text>
      <text x="${W - 80}" y="120" text-anchor="end" font-family="${MONO}" font-size="34" fill="#6b7365">best so far</text>
      <text x="${W - 80}" y="190" text-anchor="end" font-family="${MONO}" font-size="64" fill="${GREEN}">${best}</text></svg>`;
    put(await sharp(Buffer.from(svg)).composite([{ input: img, left: (W - iw) / 2, top: 40 }]).png().toBuffer());
  }
  encode(dir, join(OUT, `flipbook_${slug}.mp4`), 8);
}

async function beforeAfter(slug: string, first: Row, champ: Row) {
  const dir = join(OUT, "_frames");
  const put = frames(dir);
  const ih = 1000;
  const iw = Math.round((ih * 4) / 5);
  const a = await sharp(first.path).resize(iw, ih, { fit: "cover" }).toBuffer();
  const b = await sharp(champ.path).resize(iw, ih, { fit: "cover" }).toBuffer();
  const left = (W - iw) / 2;
  const label = (t: string, s: number, color: string, x: number, anchor: string) =>
    `<text x="${x}" y="540" text-anchor="${anchor}" font-family="${MONO}" font-size="40" fill="${color}">${t}</text><text x="${x}" y="620" text-anchor="${anchor}" font-family="${MONO}" font-size="96" fill="${color}">${s}</text>`;
  const total = 30 + 54 + 60;
  for (let f = 0; f < total; f++) {
    const t = Math.min(1, Math.max(0, (f - 30) / 54));
    const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2; // easeInOutCubic
    const cut = Math.round(iw * e);
    const layers: sharp.OverlayOptions[] = [{ input: a, left, top: 40 }];
    if (cut > 0) layers.push({ input: await sharp(b).extract({ left: 0, top: 0, width: cut, height: ih }).toBuffer(), left, top: 40 });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      ${cut > 0 && cut < iw ? `<rect x="${left + cut - 2}" y="40" width="4" height="${ih}" fill="#e6e9e1"/>` : ""}
      ${label("FIRST RENDER", first.score, "#9ba493", left - 60, "end")}
      ${label("AFTER ONE NIGHT", champ.score, GREEN, left + iw + 60, "start")}</svg>`;
    layers.push({ input: Buffer.from(svg) });
    put(await sharp({ create: { width: W, height: H, channels: 3, background: BG } }).composite(layers).png().toBuffer());
  }
  encode(dir, join(OUT, `before_after_${slug}.mp4`));
}

async function contactSheet(slug: string, all: Row[]) {
  const cols = Math.ceil(Math.sqrt(all.length * 1.6));
  const tw = Math.floor(W / cols);
  const th = Math.round((tw * 5) / 4);
  const rows = Math.ceil(all.length / cols);
  const tiles = await Promise.all(
    all.map(async (r, i) => ({ input: await sharp(r.path).resize(tw - 4, th - 4, { fit: "cover" }).toBuffer(), left: (i % cols) * tw + 2, top: Math.floor(i / cols) * th + 2 })),
  );
  await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: BG } }).composite(tiles).png().toFile(join(OUT, `contact_${slug}.png`));
}

// --- Main
mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ? Number(process.argv[2]) : null;
const jobs = db.prepare(`SELECT id, name, brief, created_at FROM jobs WHERE active = 1 ${only ? "AND id = ?" : ""} ORDER BY id`).all(...(only ? [only] : [])) as {
  id: number;
  name: string;
  brief: string;
  created_at: string;
}[];

const manifest: any = { generatedAt: new Date().toISOString(), format: { width: W, height: H, fps: FPS }, products: [] };
for (const job of jobs) {
  const all = db
    .prepare("SELECT id, generation, ts, score, hypothesis, critique, champion, path, seconds FROM renders WHERE job_id = ? AND score IS NOT NULL AND path IS NOT NULL ORDER BY id")
    .all(job.id) as Row[];
  if (all.length < 2) continue;
  const champs = all.filter((r) => r.champion);
  const first = champs[0];
  const champ = champs.at(-1)!;
  const slug = job.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  console.log(`▶ ${job.name} : ${all.length} rendus, ${champs.length} champions, ${first.score} → ${champ.score}`);
  await lineageClip(slug, job.name, champs);
  await flipbook(slug, all);
  await beforeAfter(slug, first, champ);
  await contactSheet(slug, all);
  const crit = (r: Row) => (r.critique ? JSON.parse(r.critique) : null);
  manifest.products.push({
    id: job.id,
    slug,
    name: job.name,
    brief: job.brief,
    renders: all.length,
    generations: Math.max(...all.map((r) => r.generation)),
    gpuSeconds: Math.round(all.reduce((s, r) => s + (r.seconds ?? 0), 0)),
    firstScore: first.score,
    championScore: champ.score,
    gain: champ.score - first.score,
    files: {
      lineage: `lineage_${slug}.mp4`,
      flipbook: `flipbook_${slug}.mp4`,
      beforeAfter: `before_after_${slug}.mp4`,
      contact: `contact_${slug}.png`,
      firstImage: first.path,
      championImage: champ.path,
    },
    champions: champs.map((c) => ({ id: c.id, generation: c.generation, ts: c.ts, score: c.score, strategy: strategy(c), hypothesis: hyp(c), artDirector: crit(c)?.one_liner ?? null })),
  });
}
rmSync(join(OUT, "_frames"), { recursive: true, force: true });
const totals = db.prepare("SELECT count(*) n, coalesce(sum(seconds), 0) s FROM renders WHERE error IS NULL").get() as { n: number; s: number };
manifest.totals = { renders: totals.n, gpuMinutes: Math.round(totals.s / 60), products: manifest.products.length };
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`✓ Rushs dans ${OUT}`);
