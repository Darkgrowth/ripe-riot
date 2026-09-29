import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { execFileSync } from 'node:child_process';

function buildId(): string {
  if (process.env.RIPE_BUILD_ID) return process.env.RIPE_BUILD_ID.slice(0, 80);
  try { return execFileSync('git', ['describe', '--always', '--dirty'], { encoding: 'utf8' }).trim(); }
  catch { return 'development'; }
}

export default defineConfig({
  define: { __RIPE_BUILD_ID__: JSON.stringify(buildId()) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        voxelProof: fileURLToPath(new URL('./voxel-proof.html', import.meta.url)),
        blockProof: fileURLToPath(new URL('./block-proof.html', import.meta.url)),
      },
    },
  },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
