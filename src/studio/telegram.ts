// Bilan du matin sur Telegram et écoute des réactions de la marque.
import sharp from "sharp";
import { champion, db, getKv, logEvent, now, setKv, type Job } from "./db.ts";
import { runIntake, runPromptIntake } from "./intake.ts";
import { recordFeedback } from "./feedback.ts";
import { LABEL_TEXT } from "./taste.ts";

const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const CHAT = () => process.env.TELEGRAM_CHAT_ID;

async function call(method: string, body: Record<string, unknown> | FormData) {
  const res = await fetch(`${API()}/${method}`, {
    method: "POST",
    ...(body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(70_000),
  });
  const j = (await res.json()) as { ok: boolean; result?: any; description?: string };
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result;
}

const keyboard = (pickId: number) => ({
  inline_keyboard: [
    [
      { text: "🔥 J'adore", callback_data: `pk:${pickId}:love` },
      { text: "👍 Bien", callback_data: `pk:${pickId}:ok` },
      { text: "👎 Non", callback_data: `pk:${pickId}:no` },
    ],
    [
      { text: "Plus épuré", callback_data: `pk:${pickId}:minimal` },
      { text: "Plus chaleureux", callback_data: `pk:${pickId}:warm` },
    ],
    [
      { text: "Plus lifestyle", callback_data: `pk:${pickId}:lifestyle` },
      { text: "Plus sombre", callback_data: `pk:${pickId}:moody` },
    ],
  ],
});

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Bilan d'un produit : stats de la nuit + champion + 2 autres meilleurs rendus de stratégies différentes.
export async function sendDigest(job: Job, sinceIso: string) {
  const stats = db
    .prepare("SELECT count(*) n, max(generation) g, min(score) lo, max(score) hi FROM renders WHERE job_id = ? AND ts >= ? AND error IS NULL")
    .get(job.id, sinceIso) as { n: number; g: number; lo: number; hi: number };
  const champs = db.prepare("SELECT count(*) n FROM renders WHERE job_id = ? AND ts >= ? AND champion = 1").get(job.id, sinceIso) as { n: number };
  const first = db.prepare("SELECT score FROM renders WHERE job_id = ? AND champion = 1 AND ts < ? ORDER BY id DESC LIMIT 1").get(job.id, sinceIso) as { score: number } | undefined;
  const champ = champion(job.id);
  if (!champ?.path || !stats.n) return;

  await call("sendMessage", {
    chat_id: CHAT(),
    parse_mode: "HTML",
    text:
      `☀️ <b>Night Studio — ${esc(job.name)}</b>\n` +
      `<i>🗼 Paris Claw Agent Challenge</i>\n` +
      `Cette nuit : ${stats.n} rendus sur RTX, ${champs.n} nouveaux champions.\n` +
      `Meilleure image : ${first ? `${first.score} → ` : ""}<b>${champ.score}/100</b>\n` +
      `Voici mes 3 propositions. Tes réactions m'apprennent ton goût pour la nuit prochaine.`,
  });

  const others = db
    .prepare(
      `SELECT * FROM renders WHERE job_id = ? AND ts >= ? AND error IS NULL AND id != ? AND path IS NOT NULL
       ORDER BY score DESC LIMIT 12`,
    )
    .all(job.id, sinceIso, champ.id) as any[];
  const picked: any[] = [];
  const strategies = new Set<string>();
  for (const r of others) {
    const s = (r.hypothesis ?? "").match(/^\[(\w+)\]/)?.[1] ?? "?";
    if (strategies.has(s)) continue;
    strategies.add(s);
    picked.push(r);
    if (picked.length === 2) break;
  }

  for (const [i, r] of [champ, ...picked].entries()) {
    const { lastInsertRowid } = db.prepare("INSERT INTO picks(render_id, ts) VALUES(?, ?)").run(r.id, now());
    const pickId = Number(lastInsertRowid);
    const crit = r.critique ? JSON.parse(r.critique) : null;
    const img = await sharp(r.path).jpeg({ quality: 90 }).toBuffer();
    const form = new FormData();
    form.set("chat_id", String(CHAT()));
    form.set("parse_mode", "HTML");
    form.set(
      "caption",
      `${i === 0 ? "🏆 <b>Champion</b>" : `Option ${i + 1}`} · #${r.id} · ${r.score}/100\n` +
        `${esc((r.hypothesis ?? "").slice(0, 300))}\n` +
        (crit ? `<i>DA : ${esc(crit.one_liner.slice(0, 200))}</i>` : ""),
    );
    form.set("reply_markup", JSON.stringify(keyboard(pickId)));
    form.set("photo", new Blob([new Uint8Array(img)], { type: "image/jpeg" }), `render-${r.id}.jpg`);
    const msg = await call("sendPhoto", form);
    db.prepare("UPDATE picks SET telegram_message_id = ? WHERE id = ?").run(msg.message_id, pickId);
  }
  logEvent("digest", `Morning digest sent: ${job.name}, ${stats.n} renders, champion ${champ.score}/100`, { jobId: job.id });
}

async function reply(text: string, replyTo?: number) {
  return call("sendMessage", { chat_id: CHAT(), text, parse_mode: "HTML", ...(replyTo ? { reply_parameters: { message_id: replyTo } } : {}) });
}

// Photo reçue → brief (Nemotron Omni) → modèle 3D (Meshy) → le produit rejoint la boucle de nuit.
async function intakePhoto(fileId: string, caption: string, messageId: number) {
  try {
    const file = await call("getFile", { file_id: fileId });
    const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`);
    const photo = Buffer.from(await res.arrayBuffer());
    await runIntake(photo, caption, "telegram", {
      onBrief: (b) => reply(`📸 Reçu : <b>${esc(b.name)}</b>\n<i>${esc(b.brief)}</i>\n\nJe construis le modèle 3D (Meshy, quelques minutes)…`, messageId),
      onDone: (jobId, b) => reply(`✅ Modèle 3D prêt. <b>${esc(b.name)}</b> rejoint le studio (produit #${jobId}). Bilan demain matin.`, messageId),
      onError: (err) => reply(`⚠️ Je n'ai pas pu traiter cette photo : ${esc(err.message).slice(0, 300)}`, messageId).catch(() => {}),
    });
  } catch {
    // déjà journalisé et signalé par runIntake
  }
}

export async function listen() {
  let lastError = "";
  for (;;) {
    try {
      const offset = Number(getKv("tg_offset") ?? 0);
      const updates: any[] = await call("getUpdates", { offset, timeout: 50, allowed_updates: ["callback_query", "message"] });
      for (const u of updates) {
        setKv("tg_offset", String(u.update_id + 1));
        // Une photo (ou une image envoyée en fichier) venant du chat autorisé : nouveau produit, traité en tâche de fond.
        const msg = u.message;
        if (msg && String(msg.chat?.id) === String(CHAT())) {
          const fileId = msg.photo?.at(-1)?.file_id ?? (msg.document?.mime_type?.startsWith("image/") ? msg.document.file_id : null);
          if (fileId) void intakePhoto(fileId, msg.caption ?? "", msg.message_id);
          // « /new bougie en soja, pot en céramique vert sauge » : produit décrit sans photo.
          const text = msg.text?.match(/^\/new(?:@\w+)?\s+([\s\S]{3,800})/)?.[1];
          if (text) {
            void reply("🧠 Nemotron rédige le brief, puis Meshy génère le modèle 3D (5 à 10 min)…", msg.message_id).catch(() => {});
            void runPromptIntake(text.trim(), "telegram")
              .then((jobId) => reply(`✅ Modèle 3D prêt, le produit #${jobId} rejoint le studio.`, msg.message_id))
              .catch((err) => reply(`⚠️ Échec : ${esc((err as Error).message).slice(0, 300)}`, msg.message_id).catch(() => {}));
          }
          continue;
        }
        const q = u.callback_query;
        const m = q?.data?.match(/^pk:(\d+):(\w+)$/);
        if (!m || !(m[2] in LABEL_TEXT)) continue;
        const pick = db.prepare("SELECT render_id FROM picks WHERE id = ?").get(Number(m[1])) as { render_id: number } | undefined;
        if (!pick) continue;
        recordFeedback(pick.render_id, m[2], null, "telegram");
        await call("answerCallbackQuery", { callback_query_id: q.id, text: `Noté : ${LABEL_TEXT[m[2]]}` }).catch(() => {});
      }
    } catch (err) {
      // Même erreur en boucle (token révoqué, réseau coupé) : un seul message dans le journal, puis on patiente.
      const msg = (err as Error).message;
      if (msg !== lastError) logEvent("error", `Telegram: ${msg}`);
      lastError = msg;
      await new Promise((r) => setTimeout(r, /Unauthorized/.test(msg) ? 60_000 : 10_000));
      continue;
    }
    lastError = "";
  }
}
