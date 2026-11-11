import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 화면(src)을 dist로 빌드한다. 배포할 때는 wrangler가 이 빌드를 먼저 돌리고 dist를 같이 올린다.
// 화면만 고칠 때는 `npm run dev:ui`로 띄우면 /api 요청이 로컬 Worker(8787)로 간다.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
