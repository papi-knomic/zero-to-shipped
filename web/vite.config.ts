import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Two pages: index.html is the static landing page (no JS); app.html is the React demo.
// Hosts rewrite extension-less paths other than / to app.html. This does the same in dev.
const appRewrite: Connect.NextHandleFunction = (req, _res, next) => {
  const [path = '/', query] = (req.url ?? '/').split('?');
  const isAppRoute = path !== '/' && !path.includes('.') && !/^\/(@|src\/|node_modules\/|api\/)/.test(path);
  if (isAppRoute) req.url = `/app.html${query ? `?${query}` : ''}`;
  next();
};

const appRoutes: Plugin = {
  name: 'lapse-app-routes',
  configureServer: (server) => void server.middlewares.use(appRewrite),
  configurePreviewServer: (server) => void server.middlewares.use(appRewrite),
};

// Deployed builds call the API on the same origin (or VITE_API_URL when set). In dev, set
// VITE_API_PROXY (the `api_url` Terraform output) in web/.env.local and Vite proxies /api.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_API_PROXY;

  return {
    plugins: [react(), appRoutes],
    appType: 'mpa',
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html'), app: resolve(__dirname, 'app.html') },
      },
    },
    server: target ? { proxy: { '/api': { target, changeOrigin: true } } } : undefined,
  };
});
