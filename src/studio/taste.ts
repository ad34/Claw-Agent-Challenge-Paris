// Goût de la marque : appris des réponses du matin, versionné (le diff nuit 1 → nuit 3 fait partie de la preuve).
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chat } from "../llm.ts";
import { db, logEvent } from "./db.ts";
import { STUDIO_DIR } from "./paths.ts";

const FILE = join(STUDIO_DIR, "taste.md");
const INITIAL = `# Brand taste

_Nothing learned yet. Rules will appear here as the owner reacts to the morning picks._
`;

export function readTaste(): string {
  if (!existsSync(FILE)) writeFileSync(FILE, INITIAL);
  return readFileSync(FILE, "utf8");
}

export const LABEL_TEXT: Record<string, string> = {
  love: "🔥 love it",
  ok: "👍 good",
  no: "👎 no",
  minimal: "more minimal",
  warm: "warmer",
  lifestyle: "more lifestyle",
  moody: "darker / moodier",
};

// Réécrit le fichier de goût à partir de toutes les réponses reçues.
// Plusieurs retours en rafale : un seul apprentissage à la fois, relancé une fois à la fin si d'autres sont arrivés.
let learning: Promise<void> | null = null;
let again = false;
export function learnTaste(): Promise<void> {
  if (learning) {
    again = true;
    return learning;
  }
  learning = doLearn().finally(() => {
    learning = null;
    if (again) {
      again = false;
      void learnTaste();
    }
  });
  return learning;
}

async function doLearn() {
  const rows = db
    .prepare(
      `SELECT p.label, p.note, r.recipe, r.hypothesis, r.critique, j.name FROM picks p
       JOIN renders r ON r.id = p.render_id JOIN jobs j ON j.id = r.job_id
       WHERE p.label IS NOT NULL ORDER BY p.id DESC LIMIT 40`,
    )
    .all() as { label: string; note: string | null; recipe: string; hypothesis: string | null; critique: string | null; name: string }[];
  if (!rows.length) return;
  const evidence = rows
    .map((r) => {
      const c = r.critique ? JSON.parse(r.critique).one_liner : "";
      const reaction = [r.label !== "note" ? LABEL_TEXT[r.label] ?? r.label : null, r.note ? `owner wrote: "${r.note}"` : null].filter(Boolean).join(" · ");
      return `- [${reaction}] ${r.name}: ${r.hypothesis ?? ""} | recipe ${r.recipe} | art director said: ${c}`;
    })
    .join("\n");
  const { message } = await chat(
    [
      {
        role: "system",
        content:
          "You maintain a brand's visual taste guide for product photography. From the owner's reactions to past renders, " +
          "write concise, actionable rules a 3D lighting artist can apply (background colors, light mood, camera, pedestal, HDRI). " +
          "The owner's words outrank the art director's opinion: when they disagree, write the rule the owner's way. " +
          "Keep rules the evidence supports, drop ones it contradicts, note confidence. Markdown, max 15 bullet points, start with '# Brand taste'.",
      },
      { role: "user", content: `Current guide:\n${readTaste()}\n\nOwner reactions (newest first):\n${evidence}` },
    ],
    { maxTokens: 900 },
  );
  const next = (message.content ?? "").trim();
  if (!next.startsWith("#")) return;
  if (existsSync(FILE)) copyFileSync(FILE, join(STUDIO_DIR, `taste-${new Date().toISOString().replace(/[:.]/g, "-")}.md`));
  writeFileSync(FILE, next + "\n");
  logEvent("taste", `Brand taste updated from ${rows.length} reactions`, { payload: { taste: next } });
}
