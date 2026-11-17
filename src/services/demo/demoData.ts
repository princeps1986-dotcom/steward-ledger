import type { AuditLog, BackupPayload, Donation, Member } from '../../contexts/types';
import { DEFAULT_OFFERING_TYPES } from '../domain/offeringDefaults';
import { lastSunday } from '../domain/dates';

/**
 * 시연용 데이터: 성도 500명 · 헌금 8만 건(오늘 이전 3년을 주 단위로 분배) · 수정/삭제 이력 6건.
 * 매년 12/25·1/1 그 날짜 하루에는 평소 한 주 분량의 5배가 몰립니다. 같은 날이면 항상 같은 내용입니다(고정 시드).
 * 시연 성도·헌금 종류·헌금 id는 모두 DEMO_PREFIX로 시작해, 앱이 시연 중인지 한 건만 보고 알 수 있습니다(demoState.ts).
 */
export const DEMO_PREFIX = 'demo-';
export const DEMO_MEMBER_COUNT = 500;
export const DEMO_DONATION_COUNT = 80_000;
const WEEKS = 156;
const SPIKE_UNITS = 5;

const pad2 = (n: number): string => String(n).padStart(2, '0');
const ymd = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parse = (s: string): Date => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function rngOf(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '전', '홍', '고', '문', '양', '손', '배', '백', '허', '유', '남'];
const GIVEN = ['민수', '서연', '지훈', '수빈', '현우', '지민', '하준', '예은', '도윤', '서윤', '준호', '지원', '승현', '유진', '태양', '나연', '성민', '은지', '재원', '소영', '진우', '다은', '동현', '혜진', '상철', '미경', '영수', '순자', '병철', '정희', '광수', '명숙', '기태', '옥순', '한결', '보람', '시우', '아린', '건우', '채원'];

/** 헌금 종류별 (비중, 금액 후보) — 기본 종류(DEFAULT_OFFERING_TYPES)의 순서와 같습니다. */
const TYPE_MIX: { weight: number; amounts: number[] }[] = [
  { weight: 24, amounts: [50000, 100000, 100000, 150000, 200000, 300000, 500000] },
  { weight: 46, amounts: [1000, 2000, 5000, 5000, 10000, 10000, 20000] },
  { weight: 10, amounts: [10000, 20000, 30000, 50000, 100000] },
  { weight: 6, amounts: [50000, 100000, 200000, 500000, 1000000] },
  { weight: 6, amounts: [10000, 30000, 50000, 100000] },
  { weight: 5, amounts: [5000, 10000, 30000, 50000] },
  { weight: 3, amounts: [100000, 300000, 500000] },
];

/** total을 weights 비율로 나눕니다(합이 정확히 total이 되도록 소수점 큰 쪽부터 1씩 더함). */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((s, n) => s + n, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out;
}

function buildMembers(rnd: () => number): Member[] {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const members: Member[] = [];
  const stamp = new Date(Date.UTC(2024, 0, 1)).toISOString();
  const add = (o: Partial<Member> & { name: string }): Member => {
    const m: Member = {
      id: `${DEMO_PREFIX}m-${String(members.length + 1).padStart(4, '0')}`,
      position: '',
      isFamilyHead: false,
      isActive: true,
      createdAt: stamp,
      updatedAt: stamp,
      ...o,
    };
    members.push(m);
    return m;
  };
  const phone = (): string => String(Math.floor(rnd() * 10000)).padStart(4, '0');
  while (members.length < DEMO_MEMBER_COUNT) {
    const size = Math.min(DEMO_MEMBER_COUNT - members.length, pick([1, 2, 2, 3, 3, 4, 5]));
    const surname = pick(SURNAMES);
    const head = add({ name: surname + pick(GIVEN), position: pick(['집사', '집사', '권사', '장로', '']), phoneLast4: phone(), isFamilyHead: true });
    head.familyGroupId = head.id;
    for (let k = 1; k < size; k++) {
      add({ name: (k === 1 ? pick(SURNAMES) : surname) + pick(GIVEN), position: k === 1 ? pick(['집사', '권사', '']) : '', familyGroupId: head.id, ...(rnd() < 0.5 ? { phoneLast4: phone() } : {}) });
    }
  }
  // 이사 간 성도 약 4%는 비활성(과거 내역 조회 확인용)
  for (const m of members) if (!m.isFamilyHead && rnd() < 0.04) m.isActive = false;
  return members;
}

export function buildDemoPayload(today: Date = new Date(), seed = 20261116): BackupPayload {
  const rnd = rngOf(seed);
  const members = buildMembers(rnd);
  const activeMembers = members.filter((m) => m.isActive);
  const offeringTypes = DEFAULT_OFFERING_TYPES.map((t, i) => ({ ...t, id: `${DEMO_PREFIX}t-${i + 1}` }));
  const typeWeights = TYPE_MIX.map((t) => t.weight);
  const typeTotal = typeWeights.reduce((s, w) => s + w, 0);

  // 구간(버킷): 주마다 1단위(일요일 70%·나머지 요일 30%), 12/25·1/1 날짜는 하루에 5단위
  const todayStr = ymd(today);
  const lastSun = parse(lastSunday(today));
  const firstSun = addDays(lastSun, -7 * (WEEKS - 1));
  const buckets: { dates: string[]; dayWeights: number[]; weight: number }[] = [];
  for (let i = 0; i < WEEKS; i++) {
    const sun = addDays(lastSun, -7 * i);
    const days = [0, 1, 2, 3, 4, 5, 6].map((k) => ymd(addDays(sun, k))).filter((d) => d <= todayStr);
    buckets.push({ dates: days, dayWeights: days.map((_, k) => (k === 0 ? 70 : 30 / Math.max(1, days.length - 1))), weight: 1 });
  }
  for (let y = firstSun.getFullYear(); y <= today.getFullYear(); y++) {
    for (const md of ['01-01', '12-25']) {
      const d = `${y}-${md}`;
      if (d >= ymd(firstSun) && d <= todayStr) buckets.push({ dates: [d], dayWeights: [1], weight: SPIKE_UNITS });
    }
  }
  const perBucket = allocate(DEMO_DONATION_COUNT, buckets.map((b) => b.weight));

  const donations: Donation[] = [];
  const anonSeq = new Map<string, number>();
  let seq = 0;
  buckets.forEach((b, bi) => {
    const perDay = allocate(perBucket[bi], b.dayWeights);
    b.dates.forEach((date, di) => {
      for (let n = 0; n < perDay[di]; n++) {
        let r = rnd() * typeTotal;
        let ti = 0;
        while (ti < typeWeights.length - 1 && (r -= typeWeights[ti]) > 0) ti++;
        const amount = TYPE_MIX[ti].amounts[Math.floor(rnd() * TYPE_MIX[ti].amounts.length)];
        const anon = rnd() < 0.15;
        const m = anon ? null : activeMembers[Math.floor(rnd() * activeMembers.length)];
        const a = (anonSeq.get(date) ?? 0) + (anon ? 1 : 0);
        if (anon) anonSeq.set(date, a);
        const sec = n * 7;
        donations.push({
          id: `${DEMO_PREFIX}d-${(++seq).toString(36).padStart(6, '0')}`,
          date,
          memberId: m ? m.id : null,
          donorDisplayName: m ? m.name : `무명${a}`,
          familyGroupIdSnapshot: m ? m.familyGroupId ?? null : null,
          offeringTypeId: offeringTypes[ti].id,
          amount,
          createdAt: `${date}T${pad2(9 + Math.floor(sec / 3600) % 12)}:${pad2(Math.floor(sec / 60) % 60)}:${pad2(sec % 60)}.${String(n % 1000).padStart(3, '0')}Z`,
        });
      }
    });
  });

  const donationsByYear: Record<string, Donation[]> = {};
  for (const d of donations) (donationsByYear[d.date.slice(0, 4)] ??= []).push(d);

  // 수정/삭제 이력 6건(가장 최근 연도의 내역에서 고름)
  const recent = donationsByYear[todayStr.slice(0, 4)] ?? donations;
  const auditLogsByYear: Record<string, AuditLog[]> = {};
  for (let i = 0; i < 6; i++) {
    const d = recent[Math.floor(rnd() * recent.length)];
    const update = i % 2 === 0;
    const log: AuditLog = {
      id: `${DEMO_PREFIX}a-${i + 1}`,
      targetId: update ? d.id : `${DEMO_PREFIX}x-${i + 1}`, // 삭제된 내역은 지금 목록에 없는 id
      action: update ? 'UPDATE' : 'DELETE',
      beforeSnapshot: update ? { ...d, amount: d.amount + 10000 } : { ...d, id: `${DEMO_PREFIX}x-${i + 1}` },
      afterSnapshot: update ? d : null,
      reason: update ? '금액 정정' : '중복 입력 삭제',
      timestamp: `${d.date}T18:00:0${i}.000Z`,
    };
    (auditLogsByYear[d.date.slice(0, 4)] ??= []).push(log);
  }
  return { members, offeringTypes, donationsByYear, auditLogsByYear };
}
