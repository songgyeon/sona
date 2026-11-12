import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 화면(src)을 dist로 빌드한다. 배포할 때는 wrangler가 이 빌드를 먼저 돌리고 dist를 같이 올린다.
// 화면만 고칠 때는 `npm run dev:ui`로 띄우면 /api 요청이 로컬 Worker(8787)로 간다.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 글꼴은 글자 조각(unicode-range)마다 따로 두어야 화면에 나온 글자의 조각만 받는다.
    // 작은 조각을 CSS 안에 넣어 버리면 쓰지 않는 글자까지 다 받는다
    assetsInlineLimit: (file: string) => (/\.woff2?$/.test(file) ? false : undefined),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
