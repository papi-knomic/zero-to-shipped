import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Deployed builds call VITE_API_URL directly. In dev, leave that unset and set
// VITE_API_PROXY (the `api_url` Terraform output) in web/.env.local: Vite proxies /api
// server-side, so the API's CORS allow-list doesn't need to include localhost.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_API_PROXY;

  return {
    plugins: [react()],
    server: target ? { proxy: { '/api': { target, changeOrigin: true } } } : undefined,
  };
});
