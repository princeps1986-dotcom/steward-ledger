// 구글 로그인 설정. Google Cloud Console에서 만든 "데스크톱 앱" 유형의 OAuth 클라이언트 값을 넣습니다.
// 이 값들은 비밀이 아닙니다(데스크톱 앱 클라이언트는 비밀을 지킬 수 없는 공개 클라이언트이고 PKCE로 보호됨).
// 개발 실행(npm run dev:app)에서는 환경변수 STEWARD_GOOGLE_CLIENT_ID / STEWARD_GOOGLE_CLIENT_SECRET이 우선합니다.
module.exports = {
  clientId: '',
  clientSecret: '', // 구글이 발급했고 토큰 교환에 필요하다고 할 때만 넣습니다(선택).
};
