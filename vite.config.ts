import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works from a project subpath
  // (…/zip/) without knowing the deploy URL at build time.
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' }
});
