import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'node20',
    lib: {
      entry: resolve(__dirname, 'src/container-server.ts'),
      formats: ['es'],
      fileName: 'container-server',
    },
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: [
        'node:http',
        'node:child_process',
        'node:readline',
        'node:events',
        'node:fs',
        'node:path',
        'node:url',
        'node:crypto',
        /^node:/,
      ],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
      },
    },
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
