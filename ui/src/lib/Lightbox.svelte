<script lang="ts">
  import { retryImg } from "./retryImg";
  import gsap from "gsap";
  import { tick } from "svelte";
  import { hypothesisText, imageUrl, parseCritique, type Render } from "../api";
  import ExportPanel from "./ExportPanel.svelte";
  import Viewer3D from "./Viewer3D.svelte";

  // Plein écran : rendu en pleine résolution, navigation ← → dans la liste affichée, Échap pour fermer.
  let { items, openId = $bindable() }: { items: Render[]; openId: number | null } = $props();

  let dialog: HTMLDialogElement;
  let mode = $state<"image" | "3d">("image");
  let img: HTMLImageElement | undefined = $state();
  const index = $derived(items.findIndex((r) => r.id === openId));
  const current = $derived(index >= 0 ? items[index] : null);
  const crit = $derived(current ? parseCritique(current) : null);

  $effect(() => {
    if (openId !== null && !dialog.open) {
      dialog.showModal();
      tick().then(() => img && gsap.fromTo(img, { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 0.35, ease: "power3.out" }));
    }
    if (openId === null && dialog.open) dialog.close();
  });

  function go(step: number) {
    if (index < 0) return;
    const next = items[Math.min(items.length - 1, Math.max(0, index + step))];
    if (next && next.id !== openId) {
      openId = next.id;
      tick().then(() => img && gsap.fromTo(img, { opacity: 0.4 }, { opacity: 1, duration: 0.25, ease: "power2.out" }));
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowRight") go(1);
    if (e.key === "ArrowLeft") go(-1);
    if (e.key === "3") mode = mode === "3d" ? "image" : "3d";
    if (mode === "3d") return;
    if (e.key === "+" || e.key === "=") zoomAt(view.s * 1.5);
    if (e.key === "-") zoomAt(view.s / 1.5);
    if (e.key === "0") zoomAt(1);
  }

  // --- Zoom : molette centrée sur le curseur, glisser pour se déplacer, double-clic ×2,5 ↔ vue entière.
  const MAX = 8;
  let stage: HTMLDivElement | undefined = $state();
  let view = $state({ s: 1, x: 0, y: 0 });
  let drag: { px: number; py: number; x: number; y: number } | null = null;
  let panning = $state(false);

  const clamp = (v: { s: number; x: number; y: number }) => {
    if (!stage || v.s <= 1) return { s: 1, x: 0, y: 0 };
    // On garde toujours de l'image à l'écran : le déplacement est borné par la taille zoomée.
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    return { s: v.s, x: Math.min(0, Math.max(w - w * v.s, v.x)), y: Math.min(0, Math.max(h - h * v.s, v.y)) };
  };

  // Zoom vers un point (coordonnées dans la zone d'image), par défaut le centre.
  function zoomAt(target: number, px?: number, py?: number, animate = true) {
    if (!stage) return;
    const s = Math.min(MAX, Math.max(1, target));
    const cx = px ?? stage.clientWidth / 2;
    const cy = py ?? stage.clientHeight / 2;
    const k = s / view.s;
    const next = clamp({ s, x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k });
    if (!animate) return void (view = next);
    const from = { ...view };
    gsap.to(from, { ...next, duration: 0.3, ease: "power3.out", onUpdate: () => (view = { s: from.s, x: from.x, y: from.y }) });
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = stage!.getBoundingClientRect();
    zoomAt(view.s * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top, false);
  }

  function onDblClick(e: MouseEvent) {
    const r = stage!.getBoundingClientRect();
    zoomAt(view.s > 1.05 ? 1 : 2.5, e.clientX - r.left, e.clientY - r.top);
  }

  function onPointerDown(e: PointerEvent) {
    if (view.s <= 1) return;
    drag = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
    panning = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    view = clamp({ s: view.s, x: drag.x + e.clientX - drag.px, y: drag.y + e.clientY - drag.py });
  }
  const onPointerUp = () => {
    drag = null;
    panning = false;
  };

  // Svelte rend les « onwheel » passifs (preventDefault ignoré) : écouteur non passif posé au montage.
  function wheelZoom(el: HTMLElement) {
    const handler = (e: WheelEvent) => onWheel(e);
    el.addEventListener("wheel", handler, { passive: false });
    return { destroy: () => el.removeEventListener("wheel", handler) };
  }

  // Nouveau rendu affiché : on revient à la vue entière.
  $effect(() => {
    void openId;
    view = { s: 1, x: 0, y: 0 };
  });
</script>

<dialog bind:this={dialog} class="modal" onclose={() => (openId = null)} onkeydown={onKey}>
  <div class="modal-box flex h-[94vh] max-h-none w-[96vw] max-w-none flex-col gap-3 overflow-hidden bg-base-100/95 p-4">
    {#if current}
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <span class="badge {current.champion ? 'badge-primary' : 'badge-ghost'} num">{current.score}/100</span>
          <span class="num text-sm text-base-content/60">#{current.id} · generation {current.generation} · {current.seconds}s on RTX</span>
          {#if current.champion}<span class="badge badge-primary badge-soft badge-sm">champion</span>{/if}
        </div>
        <div class="flex items-center gap-2">
          <ExportPanel renderId={current.id} />
          <div class="divider divider-horizontal mx-1"></div>
          <div role="tablist" class="tabs tabs-box tabs-sm">
            <button role="tab" class="tab" class:tab-active={mode === "image"} onclick={() => (mode = "image")}>Render</button>
            <button role="tab" class="tab" class:tab-active={mode === "3d"} onclick={() => (mode = "3d")}>3D</button>
          </div>
          <div class="join mr-2" class:invisible={mode === "3d"}>
            <button class="btn btn-ghost btn-sm join-item" onclick={() => zoomAt(view.s / 1.5)} disabled={view.s <= 1} aria-label="Zoom out">−</button>
            <button class="btn btn-ghost btn-sm join-item num w-16" onclick={() => zoomAt(1)} aria-label="Fit to screen">{Math.round(view.s * 100)}%</button>
            <button class="btn btn-ghost btn-sm join-item" onclick={() => zoomAt(view.s * 1.5)} disabled={view.s >= MAX} aria-label="Zoom in">+</button>
          </div>
          <span class="num text-xs text-base-content/45">{index + 1} / {items.length}</span>
          <button class="btn btn-square btn-ghost btn-sm" onclick={() => go(-1)} disabled={index <= 0} aria-label="Previous render">
            <svg viewBox="0 0 24 24" class="size-4"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" /></svg>
          </button>
          <button class="btn btn-square btn-ghost btn-sm" onclick={() => go(1)} disabled={index >= items.length - 1} aria-label="Next render">
            <svg viewBox="0 0 24 24" class="size-4"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" /></svg>
          </button>
          <form method="dialog"><button class="btn btn-square btn-ghost btn-sm" aria-label="Close">✕</button></form>
        </div>
      </div>
      {#if mode === "3d"}
        <div class="relative min-h-0 flex-1 overflow-hidden rounded-box">
          {#key current.id}<Viewer3D renderId={current.id} />{/key}
        </div>
      {:else}
      <div
        bind:this={stage}
        use:wheelZoom
        class="relative min-h-0 flex-1 touch-none overflow-hidden {view.s > 1 ? (panning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'}"
        role="img"
        aria-label="Render #{current.id}. Scroll to zoom, drag to pan, double-click to toggle zoom."
        ondblclick={onDblClick}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
      >
        <div class="absolute inset-0 origin-top-left will-change-transform" style="transform: translate({view.x}px, {view.y}px) scale({view.s})">
          <img use:retryImg bind:this={img} src={imageUrl(current.id)} alt="" draggable="false" class="h-full w-full object-contain select-none" />
        </div>
        {#if view.s === 1}
          <span class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white/80">Scroll to zoom · double-click · drag to pan</span>
        {/if}
      </div>
      {/if}
      <div class="grid grid-cols-2 gap-6 text-[13px]">
        <p class="text-pretty text-base-content/75"><span class="mr-2 text-xs text-base-content/45">Hypothesis</span>{hypothesisText(current) || "Plain baseline studio setup"}</p>
        {#if crit}<p class="text-pretty text-base-content/75"><span class="mr-2 text-xs text-base-content/45">Art director</span>{crit.one_liner}</p>{/if}
      </div>
    {/if}
  </div>
  <form method="dialog" class="modal-backdrop bg-black/80"><button>close</button></form>
</dialog>
