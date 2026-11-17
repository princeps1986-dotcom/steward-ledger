import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 배포마다 달라지는 값. 열려 있는 화면이 자기 버전과 배포된 version.json을 비교해 새 버전을 알아챕니다.
const BUILD_ID = Date.now().toString(36);

const emitVersion: Plugin = {
  name: 'emit-version',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) });
  },
};

export default defineConfig({
  // Electron은 app:// 커스텀 프로토콜로 dist를 서빙하므로 상대 경로 기준으로 빌드합니다.
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    tailwindcss(),
    emitVersion,
  ],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
} as never);
