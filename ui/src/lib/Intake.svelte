<script lang="ts">
  import { retryImg } from "./retryImg";
  import gsap from "gsap";
  import { tick } from "svelte";
  import { createFromPrompt, dismissIntake, intakePhotoUrl, retryIntake, uploadPhoto, type Intake } from "../api";
  import { onDemo, typeInto } from "../demo";

  let { intakes, onUploaded }: { intakes: Intake[]; onUploaded: () => void } = $props();

  // Un produit arrive par photo, par description, ou les deux (la description sert alors de note au directeur artistique).
  let dialog: HTMLDialogElement;
  let fileInput: HTMLInputElement;
  let file = $state<File | null>(null);
  let preview = $state<string | null>(null);
  let text = $state("");
  let sending = $state(false);
  let error = $state<string | null>(null);
  let dragOver = $state(false);

  const canSend = $derived(!!file || text.trim().length >= 3);

  // Seules les arrivées récentes ou en cours restent affichées.
  const visible = $derived(intakes.filter((i) => i.status !== "done" || Date.now() - Date.parse(i.ts) < 15 * 60_000).slice(0, 3));

  const step = (i: Intake) =>
    ({
      reading: i.kind === "prompt" ? "Nemotron Super is writing the brief" : "Nemotron Omni is reading the photo",
      modeling: i.kind === "prompt" ? "Meshy is generating the 3D model" : "Meshy is building the 3D model",
      done: "Joined tonight's shoot",
      failed: "Failed",
    })[i.status];

  $effect(() =>
    onDemo((c) => {
      if (c.type === "reset" && dialog.open && !sending) dialog.close();
      if (c.type === "intake-open") open();
      if (c.type === "intake-type") typeInto(c.text, (v) => (text = v));
      if (c.type === "intake-send") send();
    }),
  );

  function open() {
    error = null;
    dialog.showModal();
  }

  function pick(f: File | undefined | null) {
    if (!f || !f.type.startsWith("image/")) return;
    file = f;
    error = null;
    if (preview) URL.revokeObjectURL(preview);
    preview = URL.createObjectURL(f);
    if (!dialog.open) dialog.showModal();
  }

  function clearPhoto() {
    file = null;
    if (preview) URL.revokeObjectURL(preview);
    preview = null;
    fileInput.value = "";
  }

  async function send() {
    if (!canSend) return;
    sending = true;
    error = null;
    try {
      if (file) await uploadPhoto(file, text.trim());
      else await createFromPrompt(text.trim());
      dialog.close();
      clearPhoto();
      text = "";
      onUploaded();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      sending = false;
    }
  }

  // Glisser une photo n'importe où sur la fenêtre.
  $effect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      dragOver = true;
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) dragOver = false;
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      dragOver = false;
      pick(e.dataTransfer?.files[0]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  });

  // Nouvelle carte d'arrivée : elle se déplie en douceur.
  let list: HTMLUListElement | undefined = $state();
  let known = new Set<number>();
  $effect(() => {
    const fresh = visible.filter((i) => !known.has(i.id)).map((i) => i.id);
    const firstLoad = known.size === 0;
    visible.forEach((i) => known.add(i.id));
    if (!fresh.length || firstLoad) return;
    tick().then(() => {
      const els = fresh.map((id) => list?.querySelector(`[data-intake="${id}"]`)).filter(Boolean);
      gsap.fromTo(els, { opacity: 0, y: -8, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: "power3.out" });
    });
  });
</script>

<div class="px-3 pt-1 pb-3">
  <button class="btn btn-primary btn-sm btn-block" onclick={open}>
    <svg viewBox="0 0 24 24" class="size-4" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
    Add a product
  </button>
  <input bind:this={fileInput} type="file" accept="image/*" class="hidden" onchange={(e) => pick((e.currentTarget as HTMLInputElement).files?.[0])} />

  {#if visible.length}
    <ul bind:this={list} class="mt-3 grid gap-2">
      {#each visible as i (i.id)}
        <li data-intake={i.id} class="group relative flex gap-3 rounded-box bg-base-200 p-2.5">
          {#if i.has_photo}
            {#key i.has_photo + i.status}
              <img use:retryImg src="{intakePhotoUrl(i.id)}?v={i.status}{i.status === 'modeling' && i.progress >= 50 ? '-refine' : ''}" alt="" class="aspect-square w-11 shrink-0 rounded-md object-cover" />
            {/key}
          {:else}
            <span class="grid aspect-square w-11 shrink-0 place-items-center rounded-md bg-base-300 text-base-content/45" aria-hidden="true">
              <svg viewBox="0 0 24 24" class="size-5"><path d="M4 7l8-4 8 4-8 4-8-4Zm0 0v10l8 4m-8-14 8 4m0 10V11m0 10 8-4V7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
            </span>
          {/if}
          <div class="min-w-0 flex-1">
            <div class="truncate pr-4 text-[13px] font-medium" title={i.caption ?? ""}>{i.name ?? (i.kind === "prompt" ? i.caption : null) ?? "New product"}</div>
            <div class="text-[11px] {i.status === 'failed' ? 'text-error' : i.status === 'done' ? 'text-primary' : 'text-base-content/55'}">
              {step(i)}{i.status === "modeling" ? ` · ${i.progress}%` : ""}
            </div>
            {#if i.status === "reading"}
              <progress class="progress progress-secondary mt-1.5 h-1"></progress>
            {:else if i.status === "modeling"}
              <progress class="progress progress-secondary mt-1.5 h-1" value={i.progress} max="100"></progress>
            {:else if i.status === "failed"}
              {#if i.error}<div class="line-clamp-2 text-[11px] text-base-content/45" title={i.error}>{i.error}</div>{/if}
              <button class="btn btn-xs btn-soft btn-secondary mt-1.5" onclick={() => retryIntake(i.id).then(onUploaded)}>Retry</button>
            {/if}
          </div>
          {#if i.status === "failed" || i.status === "done"}
            <button
              class="btn btn-ghost btn-xs btn-square absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onclick={() => dismissIntake(i.id).then(onUploaded)}
              aria-label="Dismiss"
              title="Dismiss">✕</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if dragOver}
  <div class="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-base-100/80 backdrop-blur-sm">
    <div class="rounded-box border-2 border-dashed border-primary px-16 py-12 text-center">
      <div class="text-lg font-medium">Drop a product photo</div>
      <div class="mt-1 text-sm text-base-content/55">It joins tonight's shoot</div>
    </div>
  </div>
{/if}

<dialog bind:this={dialog} class="modal">
  <div class="modal-box max-w-md">
    <h3 class="text-lg font-semibold">New product</h3>
    <p class="mt-1 text-sm text-pretty text-base-content/60">
      {#if file}
        Nemotron Omni writes the brief from the photo, Meshy turns it into a 3D model, then the studio shoots it overnight.
      {:else}
        A photo, a description, or both. With words only, Nemotron Super writes the brief and Meshy generates the 3D model from text.
      {/if}
    </p>

    {#if preview}
      <div class="relative mt-4">
        <img src={preview} alt="Selected product" class="max-h-56 w-full rounded-box bg-base-200 object-contain" />
        <button class="btn btn-circle btn-sm absolute top-2 right-2 border-white/15 bg-black/55 text-white" onclick={clearPhoto} disabled={sending} aria-label="Remove photo">✕</button>
      </div>
    {:else}
      <button
        class="mt-4 flex w-full items-center gap-3 rounded-box border border-dashed border-base-content/20 p-4 text-left transition-colors hover:border-primary hover:bg-base-200"
        onclick={() => fileInput.click()}
        disabled={sending}
      >
        <span class="grid size-10 place-items-center rounded-full bg-base-200 text-base-content/60" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="size-5"><path d="M4 8h3l2-3h6l2 3h3v11H4V8Z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
        </span>
        <span>
          <span class="block text-sm font-medium">Add a photo <span class="font-normal text-base-content/45">(optional)</span></span>
          <span class="block text-xs text-base-content/50">Click or drop an image anywhere</span>
        </span>
      </button>
    {/if}

    <label class="mt-4 block">
      <span class="mb-1.5 block text-sm">
        {#if file}Note for the art director <span class="text-base-content/45">(optional)</span>{:else}Describe the product{/if}
      </span>
      <textarea
        class="textarea h-24 w-full"
        placeholder={file ? "e.g. handmade soy candle, calm Scandinavian brand" : "e.g. a matte sage-green ceramic pour-over coffee dripper with a walnut stand, for a slow-living coffee brand"}
        bind:value={text}
        disabled={sending}
        maxlength="800"
        onkeydown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && send()}
      ></textarea>
    </label>
    {#if error}
      <div role="alert" class="alert alert-error alert-soft mt-3 text-sm">{error}</div>
    {/if}
    <div class="modal-action">
      <button class="btn btn-ghost" onclick={() => dialog.close()} disabled={sending}>Cancel</button>
      <button class="btn btn-primary" onclick={send} disabled={sending || !canSend}>
        {#if sending}<span class="loading loading-spinner loading-sm"></span>{/if}
        Send to the studio
      </button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button>close</button></form>
</dialog>
