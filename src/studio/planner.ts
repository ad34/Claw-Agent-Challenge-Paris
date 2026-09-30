// Le chef opérateur : Nemotron Super lit la critique du champion, l'historique et le goût de la marque,
// puis propose des variantes, chacune avec une hypothèse explicite à tester.
import { chatJson } from "../llm.ts";
import { db, type Job, type RenderRow } from "./db.ts";
import { brandNotes } from "./feedback.ts";
import { RECIPE_DOC, sanitize, type Recipe } from "./recipe.ts";

export interface Variant {
  strategy: "refine" | "explore" | "taste";
  hypothesis: string;
  recipe: Recipe;
}

const SYSTEM = `You are the director of photography of an autonomous overnight product-photo studio.
Each round you propose new shot recipes that are rendered in Blender (Cycles, RTX GPU), then judged by an art-director model.
Your goal: beat the current champion image. Learn from the history: repeat what raised scores, avoid what failed.
${RECIPE_DOC}
Return ONLY JSON: {"variants":[{"strategy":"refine"|"explore"|"taste","hypothesis":"what you change and why you expect it to win","recipe":{...full recipe...}}]}
Propose exactly 3 variants: one "refine" (targeted fixes to the champion's critique), one "explore" (a bold, different mood or composition),
one "taste" (apply the brand taste rules and the brand's direct notes as strongly as possible).
Two voices guide you: the art director (a critic model) and the brand owner (a human). Reconcile them: follow the art director on craft
(framing, exposure, shadows, clarity), but when the brand's notes conflict with the art director, the brand wins. When you resolve such a
conflict, say so in the hypothesis in a few words (e.g. "AD asks for contrast, brand wants soft: keep soft key, add rim light for shape").`;

export async function plan(job: Job, champ: RenderRow, generation: number, taste: string): Promise<Variant[]> {
  const history = db
    .prepare("SELECT generation, hypothesis, score, champion, error FROM renders WHERE job_id = ? ORDER BY id DESC LIMIT 15")
    .all(job.id) as { generation: number; hypothesis: string | null; score: number | null; champion: number; error: string | null }[];
  const critique = champ.critique ? JSON.parse(champ.critique) : null;
  const user = [
    `Product: ${job.name}. Brief: ${job.brief}`,
    `Round ${generation}.`,
    `Brand taste (learned across all products):\n${taste}`,
    `Direct notes from the brand owner on this product (highest priority, newest first):\n${brandNotes(job.id)}`,
    `Current champion (score ${champ.score}): ${champ.recipe}`,
    critique ? `Art director on the champion: issues ${JSON.stringify(critique.issues)}; suggestions ${JSON.stringify(critique.suggestions)}` : "",
    `Recent attempts (newest first):\n${history
      .map((h) => `- r${h.generation}: ${h.error ? `FAILED (${h.error.slice(0, 80)})` : `score ${h.score}${h.champion ? " → became champion" : ""}`} — ${h.hypothesis ?? "starter"}`)
      .join("\n")}`,
  ].join("\n\n");
  const out = await chatJson<{ variants: any[] }>([{ role: "system", content: SYSTEM }, { role: "user", content: user }], { maxTokens: 3000, temperature: 0.7 });
  return (out.variants ?? []).slice(0, 3).map((v) => ({
    strategy: ["refine", "explore", "taste"].includes(v.strategy) ? v.strategy : "explore",
    hypothesis: String(v.hypothesis ?? "").slice(0, 400),
    recipe: sanitize(v.recipe),
  }));
}
