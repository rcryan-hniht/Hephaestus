import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const heroReference = fileURLToPath(new URL('../assets/cosmos_2096171389.webp', import.meta.url));
const apiProxy = { '^/api/': { target: `http://127.0.0.1:${process.env.BACKEND_PORT || 8000}`, changeOrigin: true } };

export default defineConfig({
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  plugins: [{
    name: 'local-architecture-reference',
    configureServer(server) {
      server.middlewares.use('/reference/hero.webp', (_request, response) => {
        if (!existsSync(heroReference)) { response.statusCode = 404; response.end(); return; }
        response.setHeader('Content-Type', 'image/webp');
        response.end(readFileSync(heroReference));
      });
    },
    generateBundle() {
      if (existsSync(heroReference)) this.emitFile({ type: 'asset', fileName: 'reference/hero.webp', source: readFileSync(heroReference) });
    },
  }],
  root: fileURLToPath(new URL('./src', import.meta.url)),
  build: {
    chunkSizeWarningLimit: 1000,
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
});
