<script lang="ts">
  import { retryImg } from "./retryImg";
  import { imageUrl, removeJob, type Intake as IntakeRow, type JobSummary } from "../api";
  import Intake from "./Intake.svelte";

  let {
    jobs,
    intakes,
    selected = $bindable(),
    currentId,
    onUploaded,
  }: { jobs: JobSummary[]; intakes: IntakeRow[]; selected: number | null; currentId: number | null; onUploaded: () => void } = $props();

  // Recherche sur le nom et le brief.
  let query = $state("");
  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? jobs.filter((j) => `${j.name} ${j.brief}`.toLowerCase().includes(q)) : jobs;
  });

  // Retrait d'un produit raté (confirmation d'abord). Les rendus restent sur le disque.
  let confirm: HTMLDialogElement;
  let toRemove = $state<JobSummary | null>(null);
  let removing = $state(false);
  function askRemove(j: JobSummary) {
    toRemove = j;
    confirm.showModal();
  }
  async function doRemove() {
    if (!toRemove) return;
    removing = true;
    await removeJob(toRemove.id).catch(() => {});
    removing = false;
    confirm.close();
    toRemove = null;
    onUploaded();
  }
</script>

<nav aria-label="Products" class="flex min-h-0 flex-col border-r border-base-300">
  <h2 class="px-4 pt-5 pb-2 text-xs font-medium text-base-content/50">Products</h2>
  <Intake {intakes} {onUploaded} />
  {#if jobs.length > 3}
    <label class="input input-sm mx-3 mb-2 w-auto">
      <svg viewBox="0 0 24 24" class="size-4 opacity-50" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      <input type="search" placeholder="Search products" bind:value={query} onkeydown={(e) => e.key === "Escape" && (query = "")} />
      {#if query}<span class="num text-xs text-base-content/45">{shown.length}</span>{/if}
    </label>
  {/if}
  <ul class="menu w-full flex-nowrap gap-1 overflow-y-auto px-2">
    {#each shown as j (j.id)}
      <li class="group relative">
        <button class="gap-3 p-2 {j.id === selected ? 'menu-active' : ''}" onclick={() => (selected = j.id)} aria-current={j.id === selected}>
          {#if j.champion_id}
            <img use:retryImg src={imageUrl(j.champion_id, 160)} alt="" class="aspect-[4/5] w-12 shrink-0 rounded-md object-cover" />
          {:else}
            <span class="skeleton aspect-[4/5] w-12 shrink-0 rounded-md"></span>
          {/if}
          <span class="flex min-w-0 flex-col items-start">
            <span class="w-full truncate font-medium">{j.name}</span>
            <span class="num text-xs whitespace-nowrap text-base-content/50">{j.champion_score ?? "—"}/100 · {j.renders} renders</span>
            {#if j.id === currentId}
              <span class="badge badge-primary badge-soft badge-xs mt-1">live</span>
            {/if}
          </span>
        </button>
        <button
          class="btn btn-xs btn-square absolute top-1/2 right-1.5 -translate-y-1/2 border-base-300 bg-base-100/90 p-0 text-base-content/60 opacity-0 transition-opacity group-hover:opacity-100 hover:text-error focus-visible:opacity-100"
          onclick={() => askRemove(j)}
          aria-label="Remove {j.name}"
          title="Remove from the shoot list"
        >
          <svg viewBox="0 0 24 24" class="size-4" aria-hidden="true"><path d="M5 7h14M10 11v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </li>
    {:else}
      {#if query}<li class="px-3 py-2 text-xs text-base-content/45">No product matches “{query}”</li>{/if}
    {/each}
  </ul>
  <div class="mt-auto p-4 text-xs text-pretty text-base-content/40">Tip: send a photo, or <span class="num">/new</span> + a description, to the Telegram bot.</div>
</nav>

<dialog bind:this={confirm} class="modal" onclose={() => (toRemove = null)}>
  <div class="modal-box max-w-sm">
    {#if toRemove}
      <h3 class="text-lg font-semibold">Remove {toRemove.name}?</h3>
      <p class="mt-2 text-sm text-pretty text-base-content/60">
        The studio stops shooting it. Its {toRemove.renders} renders stay on disk but leave the gallery.
      </p>
      <div class="modal-action">
        <form method="dialog"><button class="btn btn-ghost" disabled={removing}>Cancel</button></form>
        <button class="btn btn-error" onclick={doRemove} disabled={removing}>
          {#if removing}<span class="loading loading-spinner loading-sm"></span>{/if}
          Remove
        </button>
      </div>
    {/if}
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>
