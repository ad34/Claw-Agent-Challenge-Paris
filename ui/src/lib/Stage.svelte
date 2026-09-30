<script lang="ts">
  import { retryImg } from "./retryImg";
  import gsap from "gsap";
  import { tick } from "svelte";
  import { hypothesisText, imageUrl, parseCritique, strategyOf, type JobSummary, type Render } from "../api";
  import Compare from "./Compare.svelte";
  import FeedbackBox from "./FeedbackBox.svelte";
  import Lightbox from "./Lightbox.svelte";
  import Viewer3D from "./Viewer3D.svelte";

  let { job, renders, onSent }: { job: JobSummary; renders: Render[]; onSent: () => void } = $props();

  const lineage = $derived(renders.filter((r) => r.champion === 1));
  const scored = $derived(renders.filter((r) => r.score !== null));
  const champ = $derived(lineage.at(-1) ?? null);
  const first = $derived(lineage[0] ?? null);

  // Rendu épinglé depuis la bande du bas ; sinon on suit le champion en direct.
  let pinnedId = $state<number | null>(null);
  const focus = $derived((pinnedId !== null && renders.find((r) => r.id === pinnedId)) || champ);
  const pinned = $derived(pinnedId !== null && focus?.id !== champ?.id);
  const crit = $derived(focus ? parseCritique(focus) : null);
  const gain = $derived(focus && first ? focus.score - first.score : 0);

  let view = $state<"champion" | "compare" | "3d">("champion");
  let stripMode = $state<"champions" | "all">("champions");
  const stripItems = $derived(stripMode === "champions" ? lineage : renders);
  let lightboxId = $state<number | null>(null);

  const CRITERIA: [string, string][] = [
    ["composition", "Composition"],
    ["lighting", "Lighting"],
    ["background", "Background"],
    ["product_clarity", "Product clarity"],
    ["commercial_appeal", "Sales appeal"],
  ];
  const STRATEGY: Record<string, string> = { refine: "Refine", explore: "Explore", taste: "Brand taste", starter: "Baseline" };

  // --- Changement de champion : l'ancien reste dessous, le nouveau se révèle par un volet diagonal.
  let shownId = $state<number | null>(null);
  let prevId = $state<number | null>(null);
  let topImg: HTMLImageElement | undefined = $state();
  let badge: HTMLElement | undefined = $state();
  let scoreEl: HTMLElement | undefined = $state();
  let jobShown = -1;
  let wasPinned = false;

  $effect(() => {
    const id = focus?.id ?? null;
    if (id === shownId) return;
    const sameJob = jobShown === job.id;
    // Volet « nouveau champion » seulement quand le champion change en direct, pas en naviguant.
    const wipe = sameJob && pinnedId === null && !wasPinned && shownId !== null;
    wasPinned = pinnedId !== null;
    jobShown = job.id;
    prevId = sameJob ? shownId : null;
    shownId = id;
    tick().then(() => {
      if (!topImg) return;
      if (wipe) {
        const tl = gsap.timeline();
        tl.fromTo(topImg, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 1.1, ease: "power3.inOut" });
        if (badge) tl.fromTo(badge, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.35, ease: "power3.out" }, "-=0.3").to(badge, { opacity: 0, duration: 0.4, delay: 2.6 });
        if (scoreEl) tl.fromTo(scoreEl, { scale: 1.15 }, { scale: 1, duration: 0.6, ease: "back.out(2)" }, 0.8);
      } else {
        // Navigation manuelle : simple fondu enchaîné.
        gsap.fromTo(topImg, { opacity: 0, scale: 1.015 }, { opacity: 1, scale: 1, duration: 0.4, ease: "power2.out" });
      }
    });
  });

  // --- Courbe : chaque rendu est un point, le champion trace une ligne en escalier.
  const W = 600;
  const H = 140;
  const PAD = 14;
  const chart = $derived.by(() => {
    const renders = scored; // les rendus en cours de critique n'ont pas encore de score
    const n = Math.max(renders.length - 1, 1);
    const scores = renders.map((r) => r.score as number);
    const lo = Math.max(0, Math.min(...scores, 100) - 5);
    const hi = Math.min(100, Math.max(...scores, 0) + 5);
    const x = (i: number) => PAD + (i / n) * (W - PAD * 2);
    const y = (s: number) => H - PAD - ((s - lo) / Math.max(hi - lo, 1)) * (H - PAD * 2);
    let best = renders[0]?.score ?? 0;
    const step: string[] = [];
    renders.forEach((r, i) => {
      const prev = best;
      if (r.champion === 1) best = r.score;
      step.push(i === 0 ? `M${x(0)},${y(best)}` : `L${x(i)},${y(prev)} L${x(i)},${y(best)}`);
    });
    const area = step.length ? `${step.join(" ")} L${x(renders.length - 1)},${H - PAD} L${x(0)},${H - PAD} Z` : "";
    return { dots: renders.map((r, i) => ({ x: x(i), y: y(r.score), champ: r.champion === 1, id: r.id })), line: step.join(" "), area, lo, hi };
  });

  let lineEl: SVGPathElement | undefined = $state();
  let lastLen = 0;
  $effect(() => {
    void chart.line;
    tick().then(() => {
      if (!lineEl) return;
      const len = lineEl.getTotalLength();
      gsap.fromTo(lineEl, { strokeDasharray: len, strokeDashoffset: len - lastLen }, { strokeDashoffset: 0, duration: lastLen ? 0.8 : 1.6, ease: "power2.inOut" });
      lastLen = len;
    });
  });

  // --- Lignée : la nouvelle vignette glisse en place.
  let strip: HTMLElement | undefined = $state();
  let lineageCount = 0;
  $effect(() => {
    const n = stripItems.length;
    tick().then(() => {
      if (strip && n > lineageCount && lineageCount > 0 && pinnedId === null) {
        const last = strip.lastElementChild;
        if (last) gsap.fromTo(last, { opacity: 0, x: 24, scale: 0.96 }, { opacity: 1, x: 0, scale: 1, duration: 0.6, ease: "power3.out" });
        strip.scrollTo({ left: strip.scrollWidth, behavior: "smooth" });
      }
      lineageCount = n;
    });
  });
</script>

<!-- Largeur du visuel dérivée de la hauteur disponible (ratio 4:5), pour que l'image ne soit jamais écrasée. -->
<section class="grid h-full min-w-0 grid-cols-[min(calc((100vh-330px)*0.8),50%)_minmax(340px,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-x-8 gap-y-5 p-6">
  <!-- Visuel -->
  <div class="flex min-h-0 min-w-0 flex-col gap-3">
    <div role="tablist" class="tabs tabs-box tabs-sm w-fit">
      <button role="tab" class="tab" class:tab-active={view === "champion"} onclick={() => (view = "champion")}>Champion</button>
      <button role="tab" class="tab" class:tab-active={view === "compare"} onclick={() => (view = "compare")} disabled={!first || first.id === champ?.id}>
        Before / after
      </button>
      <button role="tab" class="tab" class:tab-active={view === "3d"} onclick={() => (view = "3d")} disabled={!focus}>3D</button>
    </div>
    <div class="relative min-h-0 w-full flex-1 overflow-hidden rounded-box bg-base-200 ring-1 ring-base-300">
      {#if view === "3d" && focus}
        {#key focus.id}<Viewer3D renderId={focus.id} />{/key}
      {:else if view === "compare" && first && champ && first.id !== champ.id}
        <Compare before={imageUrl(first.id, 1080)} after={imageUrl(champ.id, 1080)} beforeLabel="First render · {first.score}" afterLabel="Champion · {champ.score}" />
      {:else}
        {#if prevId !== null}
          <img use:retryImg class="absolute inset-0 h-full w-full object-cover" src={imageUrl(prevId, 1080)} alt="" aria-hidden="true" />
        {/if}
        {#if focus}
          <button class="group absolute inset-0 cursor-zoom-in" onclick={() => (lightboxId = focus.id)} aria-label="Open render #{focus.id} full screen">
            <img use:retryImg bind:this={topImg} class="h-full w-full object-cover" src={imageUrl(focus.id, 1080)} alt="{pinned ? `Render #${focus.id}` : 'Current best render'}: {job.name}" />
            <span class="absolute top-4 right-4 grid size-8 place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100" aria-hidden="true">
              <svg viewBox="0 0 24 24" class="size-4"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" /></svg>
            </span>
          </button>
          <div class="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/60 to-transparent p-4 pt-16">
            <span class="num text-xs text-white/80">#{focus.id} · generation {focus.generation} · {focus.seconds}s on RTX</span>
            <span class="badge badge-sm border-white/20 bg-black/40 text-white/90">{STRATEGY[strategyOf(focus)] ?? strategyOf(focus)}</span>
          </div>
          {#if pinned}
            <button class="badge badge-neutral absolute top-4 left-4 gap-1.5 py-3" onclick={() => (pinnedId = null)}>
              Viewing #{focus.id} · {focus.score}
              <span class="text-primary">Back to champion</span>
            </button>
          {/if}
        {:else}
          <div class="grid h-full place-items-center gap-2 text-base-content/40">
            <span class="loading loading-ring loading-lg text-primary"></span>
            Preparing the first render
          </div>
        {/if}
        <span bind:this={badge} class="badge badge-primary absolute top-4 left-4 font-semibold opacity-0">New champion</span>
      {/if}
    </div>
  </div>

  <!-- Analyse -->
  <div class="flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
    <div>
      <h1 class="text-[26px] leading-tight font-semibold tracking-tight text-balance">{job.name}</h1>
      <p class="mt-1.5 max-w-[60ch] text-pretty text-base-content/60">{job.brief}</p>
    </div>

    {#if focus}
      <div class="flex items-center gap-5">
        <div bind:this={scoreEl} class="radial-progress {focus.champion ? 'text-primary' : 'text-base-content/40'}" style="--value:{focus.score}; --size:5.5rem; --thickness:6px" role="progressbar" aria-valuenow={focus.score}>
          <span class="num text-2xl font-medium text-base-content">{focus.score}</span>
        </div>
        <div>
          <div class="text-xs text-base-content/45">Art director score{pinned ? ` · render #${focus.id}` : ""}</div>
          {#if pinned && !focus.champion}
            <div class="mt-1 text-sm text-base-content/60">Did not beat the champion ({champ?.score})</div>
          {:else if gain > 0}
            <div class="num mt-1 text-lg font-medium text-primary">+{gain} pts</div>
            <div class="text-xs text-base-content/55">since the first render ({first?.score})</div>
          {:else}
            <div class="mt-1 text-sm text-base-content/60">Starting point</div>
          {/if}
        </div>
      </div>

      {#if crit}
        <ul class="grid gap-2.5">
          {#each CRITERIA as [key, label]}
            <li class="grid grid-cols-[128px_1fr_20px] items-center gap-3 text-[13px] text-base-content/65">
              <span>{label}</span>
              <progress class="progress progress-primary h-1.5" value={crit.scores[key] ?? 0} max="10"></progress>
              <span class="num text-right text-base-content">{crit.scores[key]}</span>
            </li>
          {/each}
        </ul>

        <div class="chat chat-start">
          <div class="chat-header mb-1 text-xs text-base-content/45">Art director · Nemotron Omni</div>
          <div class="chat-bubble bg-base-200 text-pretty text-base-content">{crit.one_liner}</div>
        </div>
      {/if}

      {#if focus.hypothesis}
        <div class="text-[13px]">
          <div class="mb-1 text-xs text-base-content/45">{focus.champion ? "Winning hypothesis" : "Hypothesis"} · Nemotron Super</div>
          <p class="text-pretty text-base-content/75">{hypothesisText(focus)}</p>
        </div>
      {/if}

      {#if focus.score !== null}
        <FeedbackBox render={focus} {onSent} />
      {/if}
    {/if}

    <figure class="mt-auto">
      <figcaption class="mb-1.5 flex justify-between text-xs text-base-content/45">
        <span>Progress</span>
        <span class="num">{renders.length} renders · {lineage.length} champions</span>
      </figcaption>
      <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" class="block h-[140px] w-full" role="img" aria-label="Score of every render and of the champion">
        <defs>
          <linearGradient id="fade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="#76b900" stop-opacity="0.22" />
            <stop offset="1" stop-color="#76b900" stop-opacity="0" />
          </linearGradient>
        </defs>
        {#each [0.25, 0.5, 0.75] as g}
          <line x1={PAD} x2={W - PAD} y1={PAD + g * (H - PAD * 2)} y2={PAD + g * (H - PAD * 2)} class="stroke-base-300" stroke-dasharray="2 4" vector-effect="non-scaling-stroke" />
        {/each}
        <path d={chart.area} fill="url(#fade)" />
        {#each chart.dots as d (d.id)}
          <circle cx={d.x} cy={d.y} r={d.champ ? 3.2 : 2} class={d.champ ? "fill-primary" : "fill-base-content/30"} />
        {/each}
        <path bind:this={lineEl} d={chart.line} fill="none" class="stroke-primary" stroke-width="2" vector-effect="non-scaling-stroke" />
      </svg>
    </figure>
  </div>

  <!-- Lignée des champions, ou tous les rendus -->
  <div class="col-span-2 flex min-w-0 items-center gap-4">
    <div role="tablist" class="tabs tabs-box tabs-xs shrink-0 flex-col">
      <button role="tab" class="tab" class:tab-active={stripMode === "champions"} onclick={() => (stripMode = "champions")}>Champions</button>
      <button role="tab" class="tab" class:tab-active={stripMode === "all"} onclick={() => (stripMode = "all")}>All {renders.length}</button>
    </div>
    <div bind:this={strip} class="flex gap-2.5 overflow-x-auto p-1">
      {#each stripItems as r, i (r.id)}
        <button
          class="relative aspect-[4/5] w-[68px] shrink-0 overflow-hidden rounded-lg ring-1 transition-transform duration-150 ease-out hover:-translate-y-0.5 active:scale-[0.97]
            {r.id === focus?.id ? 'ring-2 ring-base-content' : r.id === champ?.id ? 'ring-2 ring-primary' : 'ring-base-300'}"
          onclick={() => (pinnedId = r.id === champ?.id ? null : r.id)}
          ondblclick={() => (lightboxId = r.id)}
          aria-label="Show render #{r.id}, score {r.score}"
          aria-pressed={r.id === focus?.id}
        >
          <img use:retryImg src={imageUrl(r.id, 240)} alt="" loading="lazy" class="h-full w-full object-cover" />
          <span class="num absolute right-1 bottom-1 rounded px-1 text-[11px] {r.champion ? 'bg-primary text-primary-content' : 'bg-base-100/85'}">
            {#if r.score === null}<span class="loading loading-dots loading-xs align-middle"></span>{:else}{r.score}{/if}
          </span>
        </button>
        {#if stripMode === "champions" && i < stripItems.length - 1}
          <svg viewBox="0 0 12 12" class="size-3 shrink-0 self-center text-base-content/25" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
        {/if}
      {/each}
    </div>
  </div>
</section>

<Lightbox items={stripItems.some((r) => r.id === lightboxId) ? stripItems : renders} bind:openId={lightboxId} />
