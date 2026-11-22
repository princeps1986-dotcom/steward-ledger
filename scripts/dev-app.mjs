// 로컬 PC앱 모드: vite 개발 서버를 띄운 뒤 Electron 창으로 엽니다(창을 닫으면 서버도 종료).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const electronPath = createRequire(import.meta.url)('electron'); // electron 패키지는 실행 파일 경로를 내보냅니다.
const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, ELECTRON_DEV_URL: url } });
const stop = async (code) => {
  await server.close();
  process.exit(code ?? 0);
};
child.on('exit', stop);
process.on('SIGINT', () => child.kill());
