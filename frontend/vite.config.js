import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { cubicasaGallery } from './src/cubicasa-samples.js';

const heroReference = fileURLToPath(new URL('../assets/cosmos_2096171389.webp', import.meta.url));
const references = new Map([
  ['/reference/hero.webp', { path: heroReference, type: 'image/webp' }],
  ...cubicasaGallery.flatMap(sample => [
    [sample.image, { path: fileURLToPath(new URL(`../assets/cubicasa/${sample.id}/drawing.png`, import.meta.url)), type: 'image/png' }],
    [sample.source, { path: fileURLToPath(new URL(`../assets/cubicasa/${sample.id}/source.svg`, import.meta.url)), type: 'image/svg+xml' }],
  ]),
]);
const apiProxy = { '^/api/': { target: `http://127.0.0.1:${process.env.BACKEND_PORT || 8000}`, changeOrigin: true } };

export default defineConfig({
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  plugins: [{
    name: 'local-architecture-reference',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const reference = references.get(request.url?.split('?')[0]);
        if (!reference) { next(); return; }
        if (!existsSync(reference.path)) { response.statusCode = 404; response.end(); return; }
        response.setHeader('Content-Type', reference.type);
        response.end(readFileSync(reference.path));
      });
    },
    generateBundle() {
      for (const [url, reference] of references) {
        if (existsSync(reference.path)) this.emitFile({ type: 'asset', fileName: url.slice(1), source: readFileSync(reference.path) });
      }
    },
  }],
  root: fileURLToPath(new URL('./src', import.meta.url)),
  build: {
    chunkSizeWarningLimit: 1000,
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
});
