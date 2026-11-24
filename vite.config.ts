import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

// 배포마다 달라지는 값. 열려 있는 화면이 자기 버전과 배포된 version.json을 비교해 새 버전을 알아챕니다.
const BUILD_ID = Date.now().toString(36);

// 데스크톱 앱 버전: 업데이트 후 첫 실행 때 변경 내역(src/changelog.ts)을 고르는 데 씁니다.
const APP_VERSION = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

const emitVersion: Plugin = {
  name: 'emit-version',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) });
  },
};

export default defineConfig({
  // Electron은 app:// 커스텀 프로토콜로 dist를 서빙하므로 상대 경로 기준으로 빌드합니다.
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [
    react(),
    tailwindcss(),
    emitVersion,
  ],
  server: { port: 5173, strictPort: true },
  // papaparse는 CSV를 처음 읽을 때만 동적으로 불러와, 미리 묶어 두지 않으면 개발 서버가 나중에 발견하며 캐시 주소(?v=)가 바뀌어 "Failed to fetch dynamically imported module"이 납니다.
  optimizeDeps: { include: ['papaparse'] },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
} as never);
