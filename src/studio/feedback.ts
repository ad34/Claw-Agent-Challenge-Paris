// Retours de la marque (Telegram ou interface) : réactions rapides et notes libres sur un rendu.
import { db, logEvent, now } from "./db.ts";
import { LABEL_TEXT, learnTaste } from "./taste.ts";

// Colonne ajoutée après coup : les bases existantes n'ont pas encore `note`.
try {
  db.exec("ALTER TABLE picks ADD COLUMN note TEXT");
} catch {
  // déjà présente
}

export function recordFeedback(renderId: number, label: string | null, note: string | null, source: "telegram" | "ui") {
  const render = db.prepare("SELECT job_id FROM renders WHERE id = ?").get(renderId) as { job_id: number } | undefined;
  if (!render) throw new Error("Unknown render");
  if (label && !(label in LABEL_TEXT)) throw new Error("Unknown reaction");
  const text = note?.trim().slice(0, 600) || null;
  if (!label && !text) throw new Error("Write a note or pick a reaction");

  db.prepare("INSERT INTO picks(render_id, ts, label, note, answered_at) VALUES(?, ?, ?, ?, ?)").run(renderId, now(), label ?? "note", text, now());
  const what = [label ? LABEL_TEXT[label] : null, text ? `"${text}"` : null].filter(Boolean).join(" · ");
  logEvent("feedback", `Brand (${source}) on #${renderId}: ${what}`, { jobId: render.job_id, renderId, payload: { label, note: text } });

  // « J'adore » : la marque tranche, ce rendu devient le champion de référence.
  if (label === "love") {
    db.prepare("UPDATE renders SET champion = 1 WHERE id = ?").run(renderId);
    logEvent("champion", `#${renderId} promoted to champion by the brand`, { jobId: render.job_id, renderId });
  }
  void learnTaste().catch((e) => logEvent("error", `Taste learning failed: ${e.message}`));
}

// Derniers retours de la marque sur un produit, pour le planificateur et le directeur artistique.
export function brandNotes(jobId: number, limit = 12): string {
  const rows = db
    .prepare(
      `SELECT p.label, p.note, p.render_id FROM picks p JOIN renders r ON r.id = p.render_id
       WHERE r.job_id = ? AND (p.label IS NOT NULL OR p.note IS NOT NULL) ORDER BY p.id DESC LIMIT ?`,
    )
    .all(jobId, limit) as { label: string | null; note: string | null; render_id: number }[];
  if (!rows.length) return "(no direct feedback from the brand on this product yet)";
  return rows
    .map((r) => `- on render #${r.render_id}: ${[r.label && r.label !== "note" ? LABEL_TEXT[r.label] : null, r.note ? `"${r.note}"` : null].filter(Boolean).join(" · ")}`)
    .join("\n");
}
