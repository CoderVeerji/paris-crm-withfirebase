import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true, host: true }, // host:true = phone se bhi khul jaye (same WiFi)
  build: { outDir: 'dist', sourcemap: false },
  // Settings screen ke neeche dikhता hai — "kya browser latest deploy pe hai" turant confirm karne ke liye
  // (baar-baar "stale tab" wale confusion se bachne ke liye).
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
});
