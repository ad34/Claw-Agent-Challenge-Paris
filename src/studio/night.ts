// Une « génération » : planifier 3 variantes → rendre → critiquer → duel contre le champion.
import { critique, duel } from "./critic.ts";
import { champion, db, logEvent, now, type Job, type RenderRow } from "./db.ts";
import { brandNotes } from "./feedback.ts";
import { plan } from "./planner.ts";
import { resolveForRender, STARTER, type Recipe } from "./recipe.ts";
import { render, renderPath } from "./render.ts";
import { readTaste } from "./taste.ts";

async function renderAndJudge(job: Job, generation: number, recipe: Recipe, hypothesis: string | null, taste: string): Promise<RenderRow | null> {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO renders(job_id, generation, ts, recipe, hypothesis) VALUES(?, ?, ?, ?, ?)")
    .run(job.id, generation, now(), JSON.stringify(recipe), hypothesis);
  const id = Number(lastInsertRowid);
  const out = renderPath(job.id, id);
  const rep = await render(await resolveForRender(recipe), job.model, out);
  if (!rep.ok) {
    db.prepare("UPDATE renders SET error = ?, seconds = ? WHERE id = ?").run(rep.error ?? "échec", rep.seconds ?? null, id);
    logEvent("render_failed", `Render #${id} failed: ${rep.error}`, { jobId: job.id, renderId: id });
    return null;
  }
  db.prepare("UPDATE renders SET path = ?, seconds = ? WHERE id = ?").run(out, rep.seconds ?? null, id);
  logEvent("render", `Render #${id} done in ${rep.seconds}s on RTX`, { jobId: job.id, renderId: id, payload: { seconds: rep.seconds } });
  let c;
  try {
    c = await critique(out, job.brief, taste);
  } catch (err) {
    db.prepare("UPDATE renders SET path = ?, seconds = ?, error = ? WHERE id = ?").run(out, rep.seconds ?? null, `critique : ${(err as Error).message}`, id);
    logEvent("error", `Critique of #${id} failed: ${(err as Error).message}`, { jobId: job.id, renderId: id });
    return null;
  }
  db.prepare("UPDATE renders SET path = ?, seconds = ?, score = ?, critique = ? WHERE id = ?").run(out, rep.seconds ?? null, c.score, JSON.stringify(c), id);
  logEvent("critique", `#${id} scored ${c.score}/100: ${c.one_liner}`, { jobId: job.id, renderId: id, payload: { score: c.score, issues: c.issues } });
  return db.prepare("SELECT * FROM renders WHERE id = ?").get(id) as unknown as RenderRow;
}

export async function runGeneration(job: Job) {
  // Le directeur artistique juge aussi à l'aune de ce que la marque a dit sur ce produit.
  const taste = `${readTaste()}\n\nDirect notes from the brand owner on this product (they override generic preferences):\n${brandNotes(job.id)}`;
  let champ = champion(job.id);
  if (!champ) {
    logEvent("start", `New product "${job.name}": plain baseline render`, { jobId: job.id });
    const first = await renderAndJudge(job, 0, STARTER, "starter: plain studio setup", taste);
    if (!first) return;
    db.prepare("UPDATE renders SET champion = 1 WHERE id = ?").run(first.id);
    logEvent("champion", `First champion: #${first.id} (${first.score}/100)`, { jobId: job.id, renderId: first.id });
    return;
  }

  const generation = (db.prepare("SELECT max(generation) g FROM renders WHERE job_id = ?").get(job.id) as { g: number }).g + 1;
  const variants = await plan(job, champ, generation, taste);
  logEvent("plan", `Generation ${generation}: ${variants.map((v) => `[${v.strategy}] ${v.hypothesis}`).join(" | ")}`, { jobId: job.id, payload: { generation } });

  const results: RenderRow[] = [];
  for (const v of variants) {
    const r = await renderAndJudge(job, generation, v.recipe, `[${v.strategy}] ${v.hypothesis}`, taste);
    if (r) results.push(r);
  }
  if (!results.length) return;

  // Le meilleur challenger (selon la critique) affronte le champion en duel.
  const best = results.reduce((a, b) => ((b.score ?? 0) > (a.score ?? 0) ? b : a));
  const d = await duel(best.path!, champ.path!, job.brief, taste);
  // Duel partagé (l'avis change avec l'ordre des images) : on départage par la critique, avec une marge de 5 points.
  const tieBreak = d.winner === "tie" && (best.score ?? 0) >= (champ.score ?? 0) + 5;
  if (tieBreak) d.reason = `Split duel, but the critique rates it ${best.score} vs ${champ.score}`;
  if (d.winner === "A" || tieBreak) {
    db.prepare("UPDATE renders SET champion = 1 WHERE id = ?").run(best.id);
    logEvent("champion", `New champion: #${best.id} beats #${champ.id}. ${d.reason}`, { jobId: job.id, renderId: best.id, payload: { beat: champ.id } });
  } else {
    logEvent("duel", `#${champ.id} keeps the title against #${best.id} (${d.winner === "tie" ? "split decision" : d.reason})`, { jobId: job.id, renderId: champ.id });
  }
}

export function activeJobs(): Job[] {
  return db.prepare("SELECT id, name, model, brief FROM jobs WHERE active = 1 ORDER BY id").all() as unknown as Job[];
}
