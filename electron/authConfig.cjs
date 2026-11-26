// 구글 로그인 설정. Google Cloud Console에서 만든 "데스크톱 앱" 유형의 OAuth 클라이언트 값을 넣습니다.
// 이 값들은 비밀이 아닙니다(데스크톱 앱 클라이언트는 비밀을 지킬 수 없는 공개 클라이언트이고 PKCE로 보호됨).
// 개발 실행(npm run dev:app)에서는 환경변수 STEWARD_GOOGLE_CLIENT_ID / STEWARD_GOOGLE_CLIENT_SECRET이 우선합니다.
// 실제 값은 git에 올리지 않는 electron/authConfig.local.cjs에 같은 모양으로 적습니다(있으면 아래 값을 덮어씀). 설치용 빌드에도 함께 들어갑니다.
const config = {
  clientId: '',
  clientSecret: '', // 구글이 발급했고 토큰 교환에 필요하다고 할 때만 넣습니다(선택).
};

try {
  Object.assign(config, require('./authConfig.local.cjs'));
} catch (e) {
  // 파일이 없을 때만 넘어갑니다(그 파일 안에서 다른 모듈을 못 찾은 경우는 오류로 알립니다).
  if (e.code !== 'MODULE_NOT_FOUND' || !String(e.message).split('\n')[0].includes('authConfig.local')) throw e;
}

module.exports = config;
