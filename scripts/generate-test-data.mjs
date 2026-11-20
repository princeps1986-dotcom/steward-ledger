// 테스트 데이터 생성기: 성도 150명 + 어제 헌금 300건 + 오늘 헌금 100건을 담은 '백업 파일(.json)'을 만듭니다.
//
// 사용법:  npm run testdata            (test-data/church-test-data_YYYYMMDD.json 생성)
//          node scripts/generate-test-data.mjs --out 경로.json --date 2026-11-16 --seed 1
//
// 앱에서 [설정 정보] > [백업 파일 복원…]으로 불러오면 됩니다.
// ※ 복원은 현재 데이터를 모두 이 파일의 내용으로 바꿉니다(복원 전에 자동 백업하지 않으니 필요하면 먼저 백업하세요).
//   실제 헌금 데이터가 들어 있는 환경에서는 사용하지 마세요.
import { createHash } from 'node:crypto';
import { buildTestPayload, addDays, parseYmd, ymd } from './testdata-core.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ── 옵션 ────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const TODAY = opt('date', ymd(new Date()));
const SEED = Number(opt('seed', '20261116'));
const OUT = resolve(opt('out', `test-data/church-test-data_${TODAY.replaceAll('-', '')}.json`));

const { payload, households, yesterdayLines, todayLines, YESTERDAY } = buildTestPayload(TODAY, SEED);
const { members, offeringTypes, auditLogsByYear } = payload;

// ── 백업 파일(체크섬 포함) 기록 ─────────────────────────
const checksum = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const envelope = { appVersion: '1.0.0', schemaVersion: 2, exportedAt: new Date().toISOString(), checksum, payload };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(envelope), 'utf8');

// ── 요약 ────────────────────────────────────────────────
const count = (arr, f) => arr.filter(f).length;
const names = new Map();
members.forEach((m) => names.set(m.name, (names.get(m.name) ?? 0) + 1));
const dupNames = [...names.entries()].filter(([, c]) => c > 1);
const sum = (arr) => arr.reduce((s, d) => s + d.amount, 0);
console.log(`생성 완료: ${OUT}`);
console.log(`성도 ${members.length}명 (활성 ${count(members, (m) => m.isActive)} / 비활성 ${count(members, (m) => !m.isActive)}), 동명이인 이름 ${dupNames.length}종 (${dupNames.map(([n, c]) => `${n}×${c}`).join(', ')})`);
console.log(`직분: ${['목사', '전도사', '집사', '권사', '', '장로'].map((p) => `${p} ${count(members, (m) => m.position === p)}`).join(', ')}`);
console.log(`세대: ${households.length}가정 (세대주 변경 1, 전원 비활성 1), 단독 ${members.filter((m) => !m.familyGroupId).length}명 / 연락처 없음 ${count(members, (m) => !m.phoneLast4)}명 / 생년월일 없음 ${count(members, (m) => !m.birthDate)}명`);
console.log(`헌금 ${YESTERDAY}(어제): ${yesterdayLines.length}건 ${sum(yesterdayLines).toLocaleString('ko-KR')}원 (무명/방문자 ${count(yesterdayLines, (d) => !d.memberId)}건, 메모 ${count(yesterdayLines, (d) => d.memo)}건)`);
console.log(`헌금 ${TODAY}(오늘): ${todayLines.length}건 ${sum(todayLines).toLocaleString('ko-KR')}원 (무명/방문자 ${count(todayLines, (d) => !d.memberId)}건, 메모 ${count(todayLines, (d) => d.memo)}건)`);
console.log(`수정·삭제 이력 ${Object.values(auditLogsByYear).flat().length}건`);
