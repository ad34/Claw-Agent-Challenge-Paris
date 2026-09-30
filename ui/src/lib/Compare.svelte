<script lang="ts">
  import { retryImg } from "./retryImg";
  import gsap from "gsap";

  // Avant / après : premier rendu de la nuit contre le champion actuel, séparés par une poignée glissable.
  let { before, after, beforeLabel, afterLabel }: { before: string; after: string; beforeLabel: string; afterLabel: string } = $props();

  let pos = $state(50);
  let box: HTMLDivElement;
  let dragging = false;

  const setFrom = (clientX: number) => {
    const r = box.getBoundingClientRect();
    pos = Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
  };

  // Au montage, la poignée balaie l'image une fois pour montrer qu'on peut comparer.
  $effect(() => {
    const t = { p: 85 };
    gsap.to(t, { p: 50, duration: 1.2, ease: "power3.inOut", delay: 0.3, onUpdate: () => (pos = t.p) });
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") pos = Math.max(0, pos - 5);
    if (e.key === "ArrowRight") pos = Math.min(100, pos + 5);
  };
</script>

<div
  bind:this={box}
  class="relative h-full w-full select-none overflow-hidden"
  role="slider"
  tabindex="0"
  aria-label="Compare the first render with the champion"
  aria-valuemin="0"
  aria-valuemax="100"
  aria-valuenow={Math.round(pos)}
  onpointerdown={(e) => {
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setFrom(e.clientX);
  }}
  onpointermove={(e) => dragging && setFrom(e.clientX)}
  onpointerup={() => (dragging = false)}
  onkeydown={onKey}
>
  <img use:retryImg src={after} alt={afterLabel} class="absolute inset-0 h-full w-full object-cover" draggable="false" />
  <img
    use:retryImg
    src={before}
    alt={beforeLabel}
    class="absolute inset-0 h-full w-full object-cover"
    style="clip-path: inset(0 {100 - pos}% 0 0)"
    draggable="false"
  />
  <div class="pointer-events-none absolute inset-y-0 w-px bg-base-content/80" style="left: {pos}%">
    <div class="absolute top-1/2 left-1/2 grid size-9 -translate-1/2 place-items-center rounded-full bg-base-content text-base-100 shadow-lg">
      <svg viewBox="0 0 24 24" class="size-4" aria-hidden="true"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </div>
  </div>
  <span class="badge badge-neutral absolute bottom-3 left-3">{beforeLabel}</span>
  <span class="badge badge-primary absolute right-3 bottom-3">{afterLabel}</span>
</div>
