import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  clearScreen: false,
  // Ne pas surveiller le dossier Rust : ses DLL verrouillées font planter le watcher sous Windows.
  server: { port: 5199, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
});
