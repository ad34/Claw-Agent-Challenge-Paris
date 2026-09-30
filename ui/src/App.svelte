<script lang="ts">
  import { fetchEvents, fetchIntakes, fetchRenders, fetchState, type AgentEvent, type Intake, type Render, type State } from "./api";
  import Feed from "./lib/Feed.svelte";
  import JobRail from "./lib/JobRail.svelte";
  import Stage from "./lib/Stage.svelte";
  import TopBar from "./lib/TopBar.svelte";

  let info = $state<State | null>(null);
  let online = $state(true);
  let selected = $state<number | null>(null);
  let renders = $state<Render[]>([]);
  let events = $state<AgentEvent[]>([]);
  let intakes = $state<Intake[]>([]);

  const job = $derived(info?.jobs.find((j) => j.id === selected) ?? null);

  async function refresh() {
    try {
      const s = await fetchState();
      info = s;
      online = true;
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
