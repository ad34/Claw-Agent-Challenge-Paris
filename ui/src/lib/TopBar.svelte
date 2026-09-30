<script lang="ts">
  import type { State } from "../api";
  import Counter from "./Counter.svelte";

  let { info, online }: { info: State | null; online: boolean } = $props();

  let clock = $state(new Date());
  $effect(() => {
    const t = setInterval(() => (clock = new Date()), 1000);
    return () => clearInterval(t);
  });

  const uptime = $derived.by(() => {
    if (!info?.runningSince) return "—";
    const s = Math.max(0, (clock.getTime() - Date.parse(info.runningSince)) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${String(m).padStart(2, "0")}m`;
  });

  const gpu = (s: number) => {
    const m = Math.round(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
  };
</script>

<header class="flex h-16 items-center gap-5 border-b whitespace-nowrap 2xl:gap-8 border-base-300 px-6">
  <div class="flex items-center gap-2.5">
    <svg viewBox="0 0 24 24" class="size-6" aria-hidden="true">
      <path d="M14.5 4.5a7.5 7.5 0 1 0 5.2 12.9 6.2 6.2 0 0 1-5.2-12.9Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
      <circle cx="17.6" cy="7" r="1.5" class="fill-primary" />
    </svg>
    <span class="text-base font-semibold tracking-tight whitespace-nowrap">Night Studio</span>
    <span class="ml-1.5 inline-flex items-center gap-1.5 rounded-full border border-primary/35 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-primary">
      <span aria-hidden="true">🗼</span> Paris Claw Agent Challenge
    </span>
  </div>

  <div class="flex min-w-0 items-center gap-2.5 whitespace-nowrap text-[13px] text-base-content/60">
    {#if !online}
      <span class="status status-error"></span>
      Agent offline
    {:else if info?.current}
      <span class="inline-grid *:[grid-area:1/1]">
        <span class="status status-primary animate-ping"></span>
        <span class="status status-primary"></span>
      </span>
      Rendering
      <span class="max-w-56 truncate font-medium text-base-content">{info.current.name}</span>
      <span class="badge badge-sm badge-ghost num hidden 2xl:inline-flex">RTX 4080 SUPER</span>
    {:else}
      <span class="status status-neutral"></span>
      Waiting for a product
    {/if}
  </div>

  <dl class="ml-auto flex gap-5 2xl:gap-8">
    <div class="flex flex-col">
      <dt class="text-[11px] text-base-content/45">Renders</dt>
      <dd class="text-lg font-medium leading-tight"><Counter value={info?.renders ?? 0} /></dd>
    </div>
    <div class="flex flex-col">
      <dt class="text-[11px] text-base-content/45">GPU time</dt>
      <dd class="text-lg font-medium leading-tight"><Counter value={info?.gpuSeconds ?? 0} format={gpu} /></dd>
    </div>
    <div class="flex flex-col" title="NVIDIA API calls in the last minute (account limit {info?.nvidia?.limit ?? 40}/min, agent capped at {info?.nvidia?.cap ?? 30})">
      <dt class="text-[11px] text-base-content/45">Nemotron</dt>
      <dd class="num text-lg font-medium leading-tight">{info?.nvidia?.rpm ?? 0}<span class="ml-1 text-xs text-base-content/45">/ {info?.nvidia?.limit ?? 40} rpm</span></dd>
    </div>
    <div class="flex flex-col">
      <dt class="text-[11px] text-base-content/45">Champions</dt>
      <dd class="text-lg font-medium leading-tight"><Counter value={info?.champions ?? 0} /></dd>
    </div>
    <div class="flex flex-col">
      <dt class="text-[11px] text-base-content/45">Reactions</dt>
      <dd class="text-lg font-medium leading-tight"><Counter value={info?.reactions ?? 0} /></dd>
    </div>
    <div class="flex flex-col">
      <dt class="text-[11px] text-base-content/45">Working for</dt>
      <dd class="num text-lg font-medium leading-tight">{uptime}</dd>
    </div>
  </dl>

  <time class="num hidden w-16 text-right xl:block text-[13px] text-base-content/55">{clock.toLocaleTimeString("en-GB")}</time>
</header>
