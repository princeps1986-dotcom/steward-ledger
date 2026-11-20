// 시험 데이터 생성 핵심 로직(파일 입출력은 하지 않음). scripts/generate-test-data.mjs가 씁니다.
// 날짜·난수 헬퍼와 이름 목록은 앱의 시연 데이터와 같은 것을 씁니다(src/services/demo/demoPrimitives.ts).
import { addDays, GIVEN, pad2, parseYmd, rngOf, SURNAMES, ymd } from '../src/services/demo/demoPrimitives.ts';

export { ymd, parseYmd, addDays };

/** today(YYYY-MM-DD) 기준: 성도 150명, 어제 헌금 300건, 오늘 헌금 100건, 수정·삭제 이력 몇 건 */
export function buildTestPayload(TODAY, SEED) {
const YESTERDAY = ymd(addDays(parseYmd(TODAY), -1));
const MEMBER_COUNT = 150;
const YESTERDAY_COUNT = 300;
const TODAY_COUNT = 100;

// ── 난수(재현 가능) ─────────────────────────────────────
const rnd = rngOf(SEED);
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
};
const hex = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
const uid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;

// ── 성도 ────────────────────────────────────────────────
const MEMBER_TS = () => new Date(Date.UTC(2024, int(0, 11), int(1, 28), int(0, 23), int(0, 59))).toISOString();
const birth = (minAge, maxAge) => {
  const y = parseYmd(TODAY).getFullYear() - int(minAge, maxAge);
  return `${y}-${pad2(int(1, 12))}-${pad2(int(1, 28))}`;
};
const phone = () => String(int(0, 9999)).padStart(4, '0');

/** @type {Array<Record<string, any>>} */
const members = [];
const usedNames = new Set();
function addMember(o) {
  const t = MEMBER_TS();
  const m = {
    id: uid(),
    name: o.name,
    position: o.position ?? '',
    ...(o.birthDate ? { birthDate: o.birthDate } : {}),
    ...(o.phoneLast4 ? { phoneLast4: o.phoneLast4 } : {}),
    ...(o.familyGroupId ? { familyGroupId: o.familyGroupId } : {}),
    isFamilyHead: !!o.isFamilyHead,
    isActive: o.isActive !== false,
    createdAt: t,
    updatedAt: t,
  };
  members.push(m);
  usedNames.add(m.name);
  return m;
}
function freshName(surname) {
  for (let i = 0; i < 500; i++) {
    const n = (surname ?? pick(SURNAMES)) + pick(GIVEN);
    if (!usedNames.has(n)) return n;
  }
  return (surname ?? pick(SURNAMES)) + pick(GIVEN) + int(1, 9);
}

// (1) 특수 사례: 동명이인·긴 이름·짧은 이름·외국 이름·기존 직분 값 등
addMember({ name: '김철수', position: '집사', phoneLast4: '1234', birthDate: birth(40, 60) });
addMember({ name: '김철수', position: '권사', phoneLast4: '5678', birthDate: birth(50, 70) });
addMember({ name: '김철수', position: '', birthDate: birth(20, 35) }); // 연락처 없음 → 직분으로 구분
addMember({ name: '이영희', position: '권사', phoneLast4: '0042', birthDate: birth(55, 75) });
addMember({ name: '이영희', position: '', phoneLast4: '7788', birthDate: birth(25, 40) });
addMember({ name: '박민수', position: '집사', phoneLast4: '3131', birthDate: birth(40, 55) });
addMember({ name: '박민수', position: '', phoneLast4: '4646', birthDate: birth(30, 45), isActive: false }); // 비활성 동명이인
addMember({ name: '최지훈', position: '집사', phoneLast4: '4242', birthDate: birth(35, 50) });
addMember({ name: '최지훈', position: '', phoneLast4: '4242', birthDate: birth(20, 30) }); // 같은 연락처 뒷자리
addMember({ name: '정수연', position: '집사' });
addMember({ name: '정수연', position: '권사' });
addMember({ name: '정수연', position: '', birthDate: birth(18, 30) });
addMember({ name: '남궁민수', position: '집사', phoneLast4: '9001', birthDate: birth(40, 60) });
addMember({ name: '황보지원', position: '권사', phoneLast4: '9002', birthDate: birth(55, 70) });
addMember({ name: '선우영희', position: '', phoneLast4: '9003', birthDate: birth(25, 45) });
addMember({ name: '독고재훈', position: '', birthDate: birth(30, 50) });
addMember({ name: '이정', position: '집사', phoneLast4: '1100', birthDate: birth(40, 60) });
addMember({ name: '한솔', position: '', phoneLast4: '2200', birthDate: birth(20, 35) });
addMember({ name: '유안', position: '', birthDate: birth(25, 40) });
addMember({ name: 'Sarah Lee', position: '', phoneLast4: '3300', birthDate: birth(25, 40) });
addMember({ name: 'John Park', position: '', phoneLast4: '3400', birthDate: birth(30, 45) });
addMember({ name: '최은총', position: '목사', phoneLast4: '1000', birthDate: birth(50, 62) });
addMember({ name: '한바울', position: '목사', phoneLast4: '1001', birthDate: birth(40, 50) });
for (const [n, ph] of [['정요한', '1101'], ['강소망', '1102'], ['윤믿음', null], ['오사랑', '1104']]) {
  addMember({ name: n, position: '전도사', phoneLast4: ph ?? undefined, birthDate: birth(26, 42) });
}
addMember({ name: '장노아', position: '장로', phoneLast4: '1201', birthDate: birth(60, 75) }); // 목록에 없는 기존 직분 값
addMember({ name: '임이삭', position: '장로', phoneLast4: '1202', birthDate: birth(60, 75) });
const specialCount = members.length;

// (2) 가정(세대) 구성: 세대주 + 배우자 + 자녀. 인원은 150명에서 단독 성도 20명을 뺀 만큼 채웁니다.
const SINGLES_RANDOM = 20;
const householdTarget = MEMBER_COUNT - specialCount - SINGLES_RANDOM;
const households = []; // {head, others}
let householdPeople = 0;
let hhIndex = 0;
while (householdPeople < householdTarget) {
  const left = householdTarget - householdPeople;
  const size = Math.min(left, pick([2, 3, 3, 4, 4, 5]));
  const surname = pick(SURNAMES);
  const position = pick(['집사', '집사', '권사', '']);
  const headId = uid();
  const head = addMember({ name: freshName(surname), position, birthDate: birth(38, 70), phoneLast4: chance(0.85) ? phone() : undefined, isFamilyHead: true });
  head.id = headId; // 그룹 ID = 최초 세대주 id
  head.familyGroupId = headId;
  const others = [];
  for (let k = 1; k < size; k++) {
    const isSpouse = k === 1 && size >= 2;
    const m = addMember(
      isSpouse
        ? { name: freshName(), position: pick(['집사', '권사', '']), birthDate: birth(36, 68), phoneLast4: chance(0.8) ? phone() : undefined, familyGroupId: headId }
        : { name: freshName(surname), position: '', birthDate: birth(3, 28), phoneLast4: chance(0.3) ? phone() : undefined, familyGroupId: headId },
    );
    others.push(m);
  }
  households.push({ head, others });
  householdPeople += size;
  hhIndex++;
}
// 세대주가 바뀐 가정(그룹 ID는 최초 세대주 id 유지): 두 번째 가정의 배우자를 새 세대주로
if (households[1] && households[1].others[0]) {
  const { head, others } = households[1];
  head.isFamilyHead = false;
  others[0].isFamilyHead = true;
}
// 전체가 이사 간 가정(모두 비활성)
if (households[2]) {
  households[2].head.isActive = false;
  households[2].others.forEach((m) => (m.isActive = false));
}

// (3) 단독 성도
for (let i = 0; i < SINGLES_RANDOM; i++) {
  addMember({
    name: freshName(),
    position: weighted([['', 6], ['집사', 3], ['권사', 2]]),
    birthDate: chance(0.75) ? birth(19, 85) : undefined,
    phoneLast4: chance(0.7) ? phone() : undefined,
  });
}
// 비활성 성도를 12명으로 맞춤(위 사례 + 단독 성도 중에서)
let inactive = members.filter((m) => !m.isActive).length;
for (const m of shuffle(members)) {
  if (inactive >= 12) break;
  if (m.isActive && !m.familyGroupId && m.position !== '목사' && !specialNames().has(m.name)) {
    m.isActive = false;
    inactive++;
  }
}
function specialNames() {
  return new Set(['김철수', '이영희', '박민수', '최지훈', '정수연', 'Sarah Lee', 'John Park', '남궁민수', '황보지원', '선우영희', '독고재훈', '이정', '한솔', '유안']);
}
if (members.length !== MEMBER_COUNT) throw new Error(`성도 수가 ${members.length}명입니다(목표 ${MEMBER_COUNT}명).`);

// ── 헌금 종류 ───────────────────────────────────────────
const T = {};
const offeringTypes = [
  { key: 'tithe', name: '십일조', displayArea: 'PRIMARY', quickAmounts: [100000, 200000, 300000, 400000, 500000], sortOrder: 1, isActive: true },
  { key: 'sunday', name: '주일헌금', displayArea: 'PRIMARY', quickAmounts: [1000, 5000, 10000], sortOrder: 2, isActive: true },
  { key: 'thanks', name: '감사헌금', displayArea: 'PRIMARY', quickAmounts: [10000, 30000, 50000], sortOrder: 3, isActive: true },
  { key: 'build', name: '건축헌금', displayArea: 'PRIMARY', quickAmounts: [1000, 5000, 10000, 50000, 100000, 500000, 1000000], sortOrder: 4, isActive: true },
  { key: 'mission', name: '선교헌금', displayArea: 'PRIMARY', quickAmounts: [1000, 5000, 10000, 30000, 50000, 100000], sortOrder: 5, isActive: true },
  { key: 'relief', name: '구제헌금', displayArea: 'PRIMARY', quickAmounts: [1000, 5000, 10000, 30000, 50000, 100000], sortOrder: 6, isActive: true },
  { key: 'special', name: '특별헌금', displayArea: 'DROPDOWN', quickAmounts: [], sortOrder: 7, isActive: true },
  { key: 'season', name: '절기헌금', displayArea: 'DROPDOWN', quickAmounts: [], sortOrder: 8, isActive: true },
  { key: 'rice', name: '사랑의쌀헌금', displayArea: 'DROPDOWN', quickAmounts: [], sortOrder: 9, isActive: false }, // 비활성 종류(과거 내역 표시·삭제 불가 확인용)
].map(({ key, ...rest }) => {
  const t = { id: uid(), ...rest };
  T[key] = t;
  return t;
});

// ── 헌금 내역 ───────────────────────────────────────────
const AMOUNTS = {
  tithe: [[50000, 3], [70000, 1], [100000, 6], [120000, 2], [150000, 3], [200000, 5], [250000, 1], [300000, 3], [400000, 1], [500000, 2], [800000, 1], [1000000, 1]],
  sunday: [[1000, 6], [2000, 3], [3000, 2], [5000, 5], [10000, 4], [20000, 1]],
  thanks: [[10000, 4], [20000, 3], [30000, 3], [50000, 3], [100000, 2], [200000, 1]],
  build: [[50000, 3], [100000, 4], [200000, 2], [300000, 1], [500000, 2], [1000000, 1], [2000000, 1]],
  mission: [[10000, 4], [30000, 3], [50000, 3], [100000, 2], [200000, 1]],
  season: [[50000, 2], [100000, 2], [300000, 1]],
  relief: [[1000, 2], [5000, 3], [10000, 4], [30000, 2], [50000, 2], [100000, 1]],
  special: [[100000, 2], [300000, 1], [500000, 1]],
  rice: [[20000, 1], [50000, 1]],
};
const MEMOS = ['생일 감사', '아기 출생 감사', '가족 대신 전달', '현금', '계좌이체 확인', '이사 감사', '병상 회복 감사', '입시 합격 감사', '선교사 후원', '장학 기금', '새가족 환영', '장기 결석 후 첫 헌금'];
const SPECIAL_MEMOS = [
  '=SUM(1+1)', // 엑셀 수식 주입 방어 확인
  '+82-10-1234-5678',
  '@용도 확인 필요',
  '-익명 요청',
  '홍길동 "대리 전달", 현금 20,000원 포함',
  '아주 긴 메모: 이 헌금은 지난주 수요예배에 참석하지 못한 가족을 대신해 담당 집사가 봉투째로 전달하였으며 영수증은 다음 주에 별도로 발행하기로 함',
];
const ANON_VISITORS = ['방문자-홍길동', '방문자-이순신', '방문자-김영수', '방문자-Peter', '방문자(타교회)'];
const adults = (list) => list.filter((m) => !m.birthDate || parseYmd(TODAY).getFullYear() - Number(m.birthDate.slice(0, 4)) >= 14);

/** 한 사람이 하루에 낼 헌금 종류 목록(확률). 아이는 주일헌금만. */
function typesFor(m) {
  const isChild = m.birthDate && parseYmd(TODAY).getFullYear() - Number(m.birthDate.slice(0, 4)) < 14;
  if (isChild) return ['sunday'];
  const list = [];
  if (chance(0.55)) list.push('tithe');
  if (chance(0.85)) list.push('sunday');
  if (chance(0.2)) list.push('thanks');
  if (chance(0.12)) list.push('build');
  if (chance(0.1)) list.push('mission');
  if (chance(0.05)) list.push('season');
  if (chance(0.06)) list.push('relief');
  if (chance(0.03)) list.push('special');
  return list.length ? list : ['sunday'];
}

function genDay(date, count, withEdgeCases) {
  const activeMembers = members.filter((m) => m.isActive);
  const lines = [];
  const used = new Set(); // `${memberId}|${typeKey}`
  const anonN = Math.round(count * 0.12);
  const dupN = Math.max(2, Math.round(count * 0.015));

  // 극단 사례(어제 데이터에만)
  const edge = [];
  if (withEdgeCases) {
    const rich = members.find((m) => m.name === '남궁민수');
    const plain = members.find((m) => m.name === '장노아');
    const kid = members.find((m) => m.isActive && m.birthDate && parseYmd(TODAY).getFullYear() - Number(m.birthDate.slice(0, 4)) < 14);
    edge.push({ m: rich, t: 'build', amount: 15000000, memo: '건축 약정금 완납(큰 금액 확인창 대상)' });
    edge.push({ m: plain, t: 'build', amount: 10000000, memo: '기준 금액과 같은 값(확인창 없음)' });
    edge.push({ m: kid, t: 'sunday', amount: 500, memo: undefined });
    edge.push({ m: members.find((m) => m.name === 'Sarah Lee'), t: 'thanks', amount: 123456, memo: undefined });
    edge.push({ m: members.find((m) => m.name === '최은총'), t: 'tithe', amount: 1000000, memo: undefined });
    SPECIAL_MEMOS.forEach((memo, i) => {
      const m = activeMembers[(i * 17) % activeMembers.length];
      edge.push({ m, t: 'thanks', amount: 10000 * (i + 1), memo, special: true });
    });
    // 비활성 헌금 종류 사용 내역 2건, 비활성 성도의 과거형 내역 2건
    edge.push({ m: activeMembers[3], t: 'rice', amount: 20000, memo: '비활성 종류' });
    edge.push({ m: activeMembers[9], t: 'rice', amount: 50000, memo: undefined });
    const gone = members.filter((m) => !m.isActive).slice(0, 2);
    gone.forEach((m) => edge.push({ m, t: 'tithe', amount: 100000, memo: '비활성 성도 내역' }));
  }
  const edgeLines = edge.filter((e) => e.m).map((e) => ({ member: e.m, t: e.t, amount: e.amount, memo: e.memo }));
  edgeLines.forEach((e) => used.add(`${e.member.id}|${e.t}`));

  const memberTarget = count - anonN - edgeLines.length - dupN;
  const donors = shuffle(adults(activeMembers).concat(activeMembers.filter((m) => !adults([m]).length)));
  const memberLines = [];
  let i = 0;
  while (memberLines.length < memberTarget) {
    const m = donors[i % donors.length];
    const pass = Math.floor(i / donors.length);
    i++;
    const keys = pass === 0 ? typesFor(m) : [pick(['tithe', 'sunday', 'thanks', 'mission'])];
    for (const t of keys) {
      if (memberLines.length >= memberTarget) break;
      const k = `${m.id}|${t}`;
      if (used.has(k)) continue;
      used.add(k);
      memberLines.push({ member: m, t, amount: weighted(AMOUNTS[t]), memo: chance(0.12) ? pick(MEMOS) : undefined });
    }
  }
  // 같은 날짜·성도·종류가 따로 저장된 내역(중복 확인창에서 '별도 저장'을 선택한 경우)
  const dups = [];
  for (let d = 0; d < dupN; d++) {
    const base = memberLines[int(0, memberLines.length - 1)];
    dups.push({ member: base.member, t: base.t, amount: weighted(AMOUNTS[base.t]), memo: '별도 저장된 동일 종류' });
  }
  const anonLines = Array.from({ length: anonN }, () => ({
    member: null,
    t: weighted([['sunday', 6], ['tithe', 2], ['thanks', 1], ['mission', 1]]),
    amount: 0,
    memo: undefined,
  }));
  anonLines.forEach((a) => (a.amount = weighted(AMOUNTS[a.t])));

  const all = shuffle([...memberLines, ...edgeLines, ...dups, ...anonLines]);
  if (all.length !== count) throw new Error(`${date} 생성 건수 ${all.length} ≠ ${count}`);

  // 입력 순서대로 시각·무명 번호 부여
  let anonNo = 1;
  let bareLeft = Math.max(2, Math.round(anonN * 0.15));
  let visitorLeft = Math.max(2, Math.round(anonN * 0.15));
  const base = new Date(`${date}T09:00:00`);
  return all.map((l, idx) => {
    const created = new Date(base.getTime() + idx * 18000 + int(0, 8000)).toISOString();
    let name = l.member?.name;
    if (!l.member) {
      if (bareLeft > 0 && chance(0.3)) {
        name = '무명';
        bareLeft--;
      } else if (visitorLeft > 0 && chance(0.3)) {
        name = pick(ANON_VISITORS);
        visitorLeft--;
      } else {
        name = `무명${anonNo++}`;
      }
    }
    return {
      id: uid(),
      date,
      memberId: l.member ? l.member.id : null,
      donorDisplayName: name,
      familyGroupIdSnapshot: l.member ? l.member.familyGroupId ?? null : null,
      offeringTypeId: T[l.t].id,
      amount: l.amount,
      ...(l.memo ? { memo: l.memo } : {}),
      createdAt: created,
    };
  });
}

const yesterdayLines = genDay(YESTERDAY, YESTERDAY_COUNT, true);
const todayLines = genDay(TODAY, TODAY_COUNT, false);

// 세대 변경 사례('납부 당시 세대 기준' 확인): 어제 내역 몇 건의 세대 스냅샷을 다른 세대로
const memberDonations = yesterdayLines.filter((d) => d.memberId && d.familyGroupIdSnapshot);
for (const d of memberDonations.slice(0, 3)) d.familyGroupIdSnapshot = households[households.length - 1].head.id;

const donationsByYear = {};
for (const d of [...yesterdayLines, ...todayLines]) (donationsByYear[d.date.slice(0, 4)] ??= []).push(d);

// ── 수정·삭제 이력(감사 로그) 몇 건 ─────────────────────
const auditLogsByYear = {};
const addAudit = (log) => (auditLogsByYear[(log.afterSnapshot ?? log.beforeSnapshot).date.slice(0, 4)] ??= []).push(log);
const stamp = (h, m) => new Date(`${TODAY}T${pad2(h)}:${pad2(m)}:00`).toISOString();
yesterdayLines.slice(10, 14).forEach((after, i) => {
  addAudit({ id: uid(), targetId: after.id, action: 'UPDATE', beforeSnapshot: { ...after, amount: after.amount * 10 }, afterSnapshot: after, reason: pick(['금액 오기입 정정', '종류 잘못 선택', '자릿수 입력 실수']), timestamp: stamp(8, 10 + i) });
});
yesterdayLines.slice(20, 22).forEach((gone, i) => {
  addAudit({ id: uid(), targetId: gone.id, action: 'DELETE', beforeSnapshot: { ...gone, id: uid(), amount: gone.amount + 5000 }, afterSnapshot: null, reason: '중복 입력 삭제', timestamp: stamp(8, 30 + i) });
});


// 성도 정보에는 생년월일을 보관하지 않으므로, 나이로 어른·아이를 가르는 위 계산에만 쓰고 출력에서는 뺍니다.
return { payload: { members: members.map(({ birthDate: _born, ...m }) => m), offeringTypes, donationsByYear, auditLogsByYear }, households, yesterdayLines, todayLines, YESTERDAY };
}
