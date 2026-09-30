// Night Studio : boucle continue (générations en tourniquet sur les produits), bilan du matin, écoute Telegram, API.
import { startApi } from "./api.ts";
import { db, getKv, logEvent, setKv } from "./db.ts";
import { activeJobs, runGeneration } from "./night.ts";
import { listen, sendDigest } from "./telegram.ts";

const DIGEST_AT = process.env.DIGEST_AT ?? "07:30"; // heure locale du bilan

function digestDue(): boolean {
  const d = new Date();
  const today = d.toLocaleDateString("sv-SE"); // AAAA-MM-JJ local
  const hhmm = d.toTimeString().slice(0, 5);
  return hhmm >= DIGEST_AT && getKv("last_digest") !== today;
}

async function morningDigest() {
  const today = new Date().toLocaleDateString("sv-SE");
  const since = getKv("last_digest_at") ?? new Date(Date.now() - 24 * 3600_000).toISOString();
  for (const job of activeJobs()) {
    try {
      await sendDigest(job, since);
    } catch (err) {
      logEvent("error", `Morning digest failed (${job.name}): ${(err as Error).message}`, { jobId: job.id });
    }
  }
  setKv("last_digest", today);
  setKv("last_digest_at", new Date().toISOString());
}

let stopping = false;
let authPaused = false;
async function loop() {
  logEvent("agent_start", `Night Studio started, morning digest at ${DIGEST_AT}`);
  while (!stopping) {
    const jobs = activeJobs();
    if (!jobs.length) {
      await new Promise((r) => setTimeout(r, 30_000));
      continue;
    }
    for (const job of jobs) {
      if (stopping) break;
      if (digestDue()) await morningDigest();
      setKv("current", JSON.stringify({ jobId: job.id, name: job.name, since: new Date().toISOString() }));
      try {
        await runGeneration(job);
        authPaused = false;
      } catch (err) {
        const msg = (err as Error).message;
        // 403 NVIDIA persistant (déjà réessayé une fois) : clé refusée. Un message, puis pause de 3 min entre les essais.
        if (/HTTP 403/.test(msg)) {
          if (!authPaused) logEvent("error", "NVIDIA API refused the key (403). Pausing 3 min between retries.");
          authPaused = true;
          await new Promise((r) => setTimeout(r, 3 * 60_000));
          break;
        }
        logEvent("error", `Generation failed (${job.name}): ${msg}`, { jobId: job.id });
        await new Promise((r) => setTimeout(r, 20_000));
      }
    }
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    logEvent("agent_stop", `Night Studio stopped (${sig})`);
    db.close();
    process.exit(0);
  });
}

// Premier démarrage : pas de bilan immédiat, le premier partira demain matin.
if (!getKv("last_digest")) {
  setKv("last_digest", new Date().toLocaleDateString("sv-SE"));
  setKv("last_digest_at", new Date().toISOString());
}

startApi();
listen();
loop();
