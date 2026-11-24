// Google ID 토큰(JWT) 검증. Electron 없이 시험할 수 있도록 순수 함수로 둡니다(src/services/auth.test.ts).
// 서명은 Node 내장 crypto로 확인합니다(JWK → 공개 키). 새 의존성을 쓰지 않습니다.
const crypto = require('node:crypto');

const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const SKEW_SEC = 60; // PC 시계가 조금 어긋나도 통과시키는 여유

function fail(msg) {
  throw new Error(`로그인 확인 실패: ${msg}`);
}

const parseJson = (part, what) => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return fail(`${what}을 읽을 수 없습니다.`);
  }
};

/**
 * 서명·발급자(iss)·대상(aud)·만료(exp)·nonce·이메일 확인을 모두 통과한 계정만 돌려줍니다.
 * keys: Google JWKS의 keys 배열 · now: 밀리초(시험에서 고정)
 */
function verifyIdToken(token, { keys, clientId, nonce, now = Date.now() }) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) fail('토큰 형식이 올바르지 않습니다.');
  const [h, p, s] = parts;
  const header = parseJson(h, '토큰 머리');
  if (header.alg !== 'RS256') fail('지원하지 않는 서명 방식입니다.'); // alg: none 등 거절
  const jwk = (keys || []).find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) fail('서명 키를 찾을 수 없습니다.');
  let valid = false;
  try {
    valid = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
  } catch {
    /* 키·서명 형식 오류는 아래에서 거절 */
  }
  if (!valid) fail('서명이 맞지 않습니다.');

  const c = parseJson(p, '토큰 내용');
  const nowSec = Math.floor(now / 1000);
  if (!ISSUERS.has(c.iss)) fail('발급자가 올바르지 않습니다.');
  if (c.aud !== clientId) fail('이 앱용 토큰이 아닙니다.');
  if (typeof c.exp !== 'number' || c.exp + SKEW_SEC <= nowSec) fail('토큰이 만료되었습니다.');
  if (typeof c.iat === 'number' && c.iat - SKEW_SEC > nowSec) fail('토큰 발급 시각이 올바르지 않습니다.');
  if (!nonce || c.nonce !== nonce) fail('요청과 맞지 않는 토큰입니다.');
  if (typeof c.sub !== 'string' || !c.sub) fail('계정 식별값이 없습니다.');
  if (typeof c.email !== 'string' || !c.email) fail('이메일 정보가 없습니다.');
  // 구글은 true 또는 "true"로 줍니다.
  if (c.email_verified !== true && c.email_verified !== 'true') fail('확인되지 않은 이메일입니다.');
  return { sub: c.sub, email: c.email.toLowerCase() };
}

module.exports = { verifyIdToken };
