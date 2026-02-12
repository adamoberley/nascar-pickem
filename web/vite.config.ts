import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [react()],
  // Load .env from repo root (parent of web/) when using workspaces
  envDir: path.resolve(__dirname, ".."),
});
