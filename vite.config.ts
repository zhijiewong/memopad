import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri spawns Vite on a fixed port and intercepts requests; do not let Vite
// auto-pick a different port.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
  },
});
