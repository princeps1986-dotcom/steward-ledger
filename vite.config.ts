import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Electron은 app:// 커스텀 프로토콜로 dist를 서빙하므로 상대 경로 기준으로 빌드합니다.
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
} as never);
