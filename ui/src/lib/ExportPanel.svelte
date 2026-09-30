<script lang="ts">
  import gsap from "gsap";
  import { tick } from "svelte";
  import { exportFileUrl, fetchExport, revealExport, startExport, type ExportStatus } from "../api";

  // Livrables du rendu affiché : même recette relancée en 4K, GLB du produit sur son socle, scène .blend.
  let { renderId }: { renderId: number } = $props();

  let st = $state<ExportStatus | null>(null);
  let now = $state(Date.now());
  let done: HTMLElement | undefined = $state();

  // Chargement initial + suivi tant que l'export tourne.
  $effect(() => {
    const id = renderId;
    st = null;
    let alive = true;
    const poll = async () => {
      const s = await fetchExport(id).catch(() => null);
      if (!alive) return;
      const wasRunning = st?.status === "running";
      st = s;
      now = Date.now();
      if (wasRunning && s?.status === "done") tick().then(() => done && gsap.fromTo(done, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }));
    };
    poll();
    const t = setInterval(() => (st?.status === "running" ? poll() : (now = Date.now())), 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  });

  async function go() {
    st = await startExport(renderId);
  }

  const elapsed = $derived(st?.startedAt ? Math.max(0, Math.round((now - Date.parse(st.startedAt)) / 1000)) : 0);
  const mb = (k: string) => (st?.sizes?.[k] ? `${(st.sizes[k] / 1048576).toFixed(1)} MB` : "");
</script>

<div class="flex items-center gap-2">
  {#if !st || st.status === "none"}
    <button class="btn btn-primary btn-sm" onclick={go}>
      <svg viewBox="0 0 24 24" class="size-4" aria-hidden="true"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      Export 4K + 3D
    </button>
  {:else if st.status === "running"}
    <span class="loading loading-ring loading-sm text-primary"></span>
    <span class="num text-sm text-base-content/70">Rendering 3072×3840 on RTX · {elapsed}s</span>
  {:else if st.status === "failed"}
    <span class="text-sm text-error" title={st.error}>Export failed</span>
    <button class="btn btn-ghost btn-sm" onclick={go}>Retry</button>
  {:else if st.files}
    <div bind:this={done} class="flex items-center gap-1.5">
      <button class="btn btn-soft btn-primary btn-sm" onclick={() => revealExport(renderId)}>Show in folder</button>
      <a class="btn btn-ghost btn-sm" href={exportFileUrl(renderId, "png")} download title={mb("png")}>4K PNG</a>
      {#if st.files.glb}<a class="btn btn-ghost btn-sm" href={exportFileUrl(renderId, "glb")} download title={mb("glb")}>GLB</a>{/if}
      {#if st.files.blend}<a class="btn btn-ghost btn-sm" href={exportFileUrl(renderId, "blend")} download title={mb("blend")}>.blend</a>{/if}
    </div>
  {/if}
</div>
