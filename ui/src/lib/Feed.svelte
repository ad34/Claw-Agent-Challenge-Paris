<script lang="ts">
  import { retryImg } from "./retryImg";
  import gsap from "gsap";
  import { tick } from "svelte";
  import { imageUrl, type AgentEvent } from "../api";

  let { events }: { events: AgentEvent[] } = $props();

  // Qui parle : le planificateur, le moteur de rendu, le directeur artistique, la marque.
  const TYPES: Record<string, { label: string; cls: string }> = {
    plan: { label: "Plan · Nemotron Super", cls: "text-base-content" },
    render: { label: "Render · Blender on RTX", cls: "text-base-content/50" },
    critique: { label: "Critique · Nemotron Omni", cls: "text-base-content" },
    duel: { label: "Duel", cls: "text-base-content/50" },
    champion: { label: "New champion", cls: "text-primary" },
    feedback: { label: "Brand reaction", cls: "text-secondary" },
    taste: { label: "Taste learned", cls: "text-secondary" },
    digest: { label: "Morning digest", cls: "text-secondary" },
    job: { label: "New product", cls: "text-base-content" },
    intake: { label: "Photo intake · Meshy", cls: "text-secondary" },
    export: { label: "Export 4K + 3D", cls: "text-primary" },
    start: { label: "First shot", cls: "text-base-content" },
    agent_start: { label: "Agent started", cls: "text-base-content/50" },
    render_failed: { label: "Render failed", cls: "text-error" },
    error: { label: "Error", cls: "text-error" },
  };
  const THUMB = new Set(["critique", "champion", "render"]);

  let list: HTMLOListElement | undefined = $state();
  let lastTop = 0;
  $effect(() => {
    const top = events[0]?.id ?? 0;
    const fresh = events.filter((e) => e.id > lastTop).length;
    const firstLoad = lastTop === 0;
    lastTop = top;
    if (!fresh) return;
    tick().then(() => {
      if (!list) return;
      const items = Array.from(list.children).slice(0, firstLoad ? 12 : fresh);
      gsap.fromTo(items, { opacity: 0, y: firstLoad ? 6 : -12 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out", stagger: firstLoad ? 0.03 : 0.07 });
    });
  });

  const time = (ts: string) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
</script>

<aside class="flex min-h-0 flex-col border-l border-base-300">
  <h2 class="flex items-center justify-between px-5 pt-5 pb-2 text-xs font-medium text-base-content/50">
    Agent log
    <span class="badge badge-ghost badge-xs num">{events.length}</span>
  </h2>
  <ol bind:this={list} class="flex-1 overflow-y-auto px-3 pb-6">
    {#each events as e (e.id)}
      {@const t = TYPES[e.type] ?? { label: e.type, cls: "text-base-content/50" }}
      <li class="relative border-l border-base-300 py-2.5 pr-2 pl-4">
        <span class="absolute top-3.5 -left-[4.5px] size-2 rounded-full {e.type === 'champion' ? 'bg-primary' : e.type.startsWith('feedback') || e.type === 'taste' ? 'bg-secondary' : 'bg-base-300'}"></span>
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-[11px] font-semibold {t.cls}">{t.label}</span>
          <time class="num shrink-0 text-[11px] text-base-content/40">{time(e.ts)}</time>
        </div>
        <div class="mt-1 flex gap-2.5">
          {#if e.render_id && THUMB.has(e.type)}
            <img use:retryImg src={imageUrl(e.render_id, 120)} alt="" loading="lazy" class="aspect-[4/5] w-9 shrink-0 rounded object-cover ring-1 ring-base-300" />
          {/if}
          <p class="line-clamp-4 text-[13px] text-pretty {e.type === 'render' || e.type === 'duel' ? 'text-base-content/55' : 'text-base-content/85'}">{e.message}</p>
        </div>
      </li>
    {/each}
  </ol>
</aside>
