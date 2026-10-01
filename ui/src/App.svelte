<script lang="ts">
  import { fetchEvents, fetchIntakes, fetchRenders, fetchState, type AgentEvent, type Intake, type Render, type State } from "./api";
  import Feed from "./lib/Feed.svelte";
  import JobRail from "./lib/JobRail.svelte";
  import Stage from "./lib/Stage.svelte";
  import TopBar from "./lib/TopBar.svelte";
  import { onDemo, runTour } from "./demo";

  let info = $state<State | null>(null);
  let online = $state(true);
  let selected = $state<number | null>(null);
  let renders = $state<Render[]>([]);
  let events = $state<AgentEvent[]>([]);
  let intakes = $state<Intake[]>([]);

  const job = $derived(info?.jobs.find((j) => j.id === selected) ?? null);

  // Mode démo : visite demandée par `npm run record-ui` (récente seulement, pour ne jamais la rejouer au démarrage).
  let lastTour = 0;
  $effect(() =>
    onDemo((c) => {
      if (c.type !== "select" || !info) return;
      const id = c.job === "current" ? info.current?.jobId : info.jobs.find((j) => j.name.toLowerCase().includes(c.job.toLowerCase()))?.id;
      if (id) selected = id;
    }),
  );

  async function refresh() {
    try {
      const s = await fetchState();
      info = s;
      online = true;
      if (s.tour && s.tour.id !== lastTour) {
        lastTour = s.tour.id;
        // Seulement dans l'app Tauri : un onglet de navigateur ouvert sur l'interface ne doit pas rejouer la visite.
        if (Date.now() - s.tour.id < 15_000 && "__TAURI_INTERNALS__" in window) runTour(s.tour.name);
      }
      // Produit retiré : on bascule sur celui en cours de shooting.
      if (selected !== null && !s.jobs.some((j) => j.id === selected)) selected = null;
      selected ??= s.current?.jobId ?? s.jobs[0]?.id ?? null;
      const fresh = await fetchEvents(events[0]?.id ?? 0);
      if (fresh.length) events = [...fresh, ...events].slice(0, 300);
      intakes = await fetchIntakes();
      if (selected !== null) {
        const r = await fetchRenders(selected);
        const last = renders.at(-1);
        if (r.length !== renders.length || r.at(-1)?.id !== last?.id || r.at(-1)?.score !== last?.score || r.at(-1)?.champion !== last?.champion) renders = r;
      }
    } catch {
      online = false;
    }
  }

  $effect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  });

  // App de bureau : la page elle-même ne défile jamais. Un focus rendu à la fermeture d'une modale (ou un
  // scrollIntoView) pouvait décaler toute l'interface hors de la fenêtre ; on la remet aussitôt en place.
  $effect(() => {
    const pin = () => {
      for (const el of [document.documentElement, document.body]) {
        if (el.scrollTop || el.scrollLeft) {
          el.scrollTop = 0;
          el.scrollLeft = 0;
        }
      }
    };
    document.addEventListener("scroll", pin, true);
    return () => document.removeEventListener("scroll", pin, true);
  });

  // Changement de produit : on recharge ses rendus immédiatement.
  $effect(() => {
    if (selected !== null) fetchRenders(selected).then((r) => (renders = r)).catch(() => {});
  });
</script>

<div class="grid h-full grid-rows-[auto_minmax(0,1fr)]">
  <TopBar {info} {online} />
  <div class="grid min-h-0 grid-cols-[248px_minmax(0,1fr)_360px] grid-rows-[minmax(0,1fr)]">
    <JobRail jobs={info?.jobs ?? []} {intakes} bind:selected currentId={info?.current?.jobId ?? null} onUploaded={refresh} />
    {#if job}
      {#key job.id}
        <Stage {job} renders={renders.filter((r) => r.job_id === job.id)} onSent={() => fetchRenders(job.id).then((r) => (renders = r))} />
      {/key}
    {:else}
      <div class="grid place-items-center text-base-content/40">
        {online ? "No product yet." : "Agent offline: run npm start in challenge/"}
      </div>
    {/if}
    <Feed {events} />
  </div>
</div>
