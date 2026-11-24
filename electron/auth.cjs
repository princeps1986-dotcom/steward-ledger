// Google 로그인(OAuth 2.0 + PKCE, 시스템 브라우저 + 127.0.0.1 loopback). 토큰은 저장하지 않습니다:
// ID 토큰으로 계정을 확인한 뒤 sub·이메일만 메모리에 두고 나머지(액세스·리프레시 토큰)는 바로 버립니다.
// 브라우저 열기·fetch·시각을 받아 쓰므로 Electron 없이 시험할 수 있습니다(src/services/auth.test.ts).
const http = require('node:http');
const crypto = require('node:crypto');
const { verifyIdToken } = require('./idToken.cjs');

// shortcut: 구글 주소를 직접 적었음(Discovery 문서를 읽지 않음), 구글이 주소를 바꾸면 Discovery 문서를 읽도록 바꾼다.
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

const PAGE = (msg) =>
  `<!doctype html><meta charset="utf-8"><title>청지기 장부</title><body style="font-family:sans-serif;text-align:center;margin-top:20vh"><h2>${msg}</h2><p>이 창을 닫고 앱으로 돌아가세요.</p>`;

/**
 * openBrowser(url): 로그인 주소를 시스템 브라우저로 엽니다(주소 검사는 호출하는 쪽).
 * clientSecret은 선택입니다(구글 데스크톱 클라이언트의 비밀값은 비밀로 취급되지 않음).
 */
function createAuth({ clientId, clientSecret, openBrowser, fetch: doFetch = fetch, now = Date.now, timeoutMs = 180000 }) {
  let session = null;
  let pending = null; // 로그인 중에 또 눌러도 같은 진행을 돌려줍니다.

  /** loopback 서버를 열고 브라우저를 띄운 뒤, state가 맞는 첫 응답에서 인증 코드를 받습니다. */
  function waitForCode({ state, challenge, nonce }) {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      let done = false;
      let timer = null;
      const finish = (err, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        server.close();
        server.closeAllConnections?.();
        if (err) reject(err);
        else resolve(value);
      };
      timer = setTimeout(() => finish(new Error('로그인 시간이 지났습니다. 다시 시도하세요.')), timeoutMs);
      server.on('error', (e) => finish(e));
      server.on('request', (req, res) => {
        const u = new URL(req.url || '/', 'http://127.0.0.1');
        // 경로·state가 다른 요청(파비콘, 다른 프로그램의 접속)은 무시하고 계속 기다립니다.
        if (u.pathname !== '/' || u.searchParams.get('state') !== state) {
          res.writeHead(404, { Connection: 'close' }).end();
          return;
        }
        const code = u.searchParams.get('code');
        const error = u.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
        res.end(PAGE(code ? '로그인되었습니다.' : '로그인하지 못했습니다.'));
        if (code) finish(null, { code, redirectUri: server.redirectUri });
        else finish(new Error(error === 'access_denied' ? '로그인을 취소했습니다.' : '로그인하지 못했습니다.'));
      });
      server.listen(0, '127.0.0.1', () => {
        server.redirectUri = `http://127.0.0.1:${server.address().port}`;
        const url = new URL(AUTH_URL);
        url.search = new URLSearchParams({
          client_id: clientId,
          redirect_uri: server.redirectUri,
          response_type: 'code',
          scope: 'openid email',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
          nonce,
        }).toString();
        Promise.resolve(openBrowser(url.toString())).catch((e) => finish(e));
      });
    });
  }

  async function postForm(url, body) {
    const res = await doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    if (!res.ok) throw new Error(`로그인 확인에 실패했습니다(${res.status}).`);
    return res.json();
  }

  async function run() {
    if (!clientId) throw new Error('로그인 설정(구글 클라이언트 ID)이 없습니다.');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('base64url');
    const nonce = crypto.randomBytes(16).toString('base64url');

    const { code, redirectUri } = await waitForCode({ state, challenge, nonce });
    const tokens = await postForm(TOKEN_URL, {
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    const jwksRes = await doFetch(JWKS_URL);
    if (!jwksRes.ok) throw new Error(`서명 키를 받지 못했습니다(${jwksRes.status}).`);
    const { keys } = await jwksRes.json();
    // 액세스·리프레시 토큰은 쓰지 않고 버립니다. 계정 확인에는 검증을 통과한 ID 토큰만 씁니다.
    session = verifyIdToken(tokens.id_token, { keys, clientId, nonce, now: now() });
    return session;
  }

  return {
    login: () => (pending ??= run().finally(() => (pending = null))),
    logout: () => {
      session = null;
    },
    session: () => session,
    status: () => ({ configured: !!clientId, email: session ? session.email : null }),
  };
}

module.exports = { createAuth };
