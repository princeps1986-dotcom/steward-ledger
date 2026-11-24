// 설치 파일을 만들기 전 검사(npm run dist가 먼저 부름). 설치한 앱은 구글 클라이언트 ID를 electron/authConfig.cjs에서만 읽으므로,
// 비어 있으면 로그인 단추가 꺼진 앱이 나가고 자동 업데이트로 기존 사용자도 자기 데이터에 들어가지 못합니다.
import { createRequire } from 'node:module';

const { clientId } = createRequire(import.meta.url)('../electron/authConfig.cjs');
if (typeof clientId !== 'string' || !clientId.trim()) {
  console.error('출시 중단: electron/authConfig.cjs의 clientId(구글 클라이언트 ID)가 비어 있습니다. 값을 넣은 뒤 다시 실행하세요.');
  process.exit(1);
}
