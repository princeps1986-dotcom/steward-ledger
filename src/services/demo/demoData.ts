import type { AuditLog, BackupPayload, Donation, Member } from '../../contexts/types';
import { DEFAULT_OFFERING_TYPES } from '../domain/offeringDefaults';
import { lastSunday, seoulNow } from '../domain/dates';
import { addDays, GIVEN, pad2, parseYmd, rngOf, SURNAMES, ymd } from './demoPrimitives';

/**
 * 시연용 데이터. 시연 성도·헌금 종류·헌금 id는 모두 DEMO_PREFIX로 시작해, 앱이 시연 중인지 한 건만 보고 알 수 있습니다(demoState.ts).
 * 같은 날이면 항상 같은 내용입니다(고정 시드). 헌금은 한 달씩 만들어 넘겨 주므로(demoMonths) 큰 규모에서도 메모리는 한 달치입니다.
 *
 * 규모는 접속 방식에 따라 다릅니다(DEMO_SPEC_APP: 데스크톱 앱, DEMO_SPEC_BROWSER: 브라우저). 오늘 이전 3년을 주 단위로 나누어 주마다 편차를 두고,
 * 매년 12/25·1/1은 그 하루에 건수가 더해집니다.
 */
export const DEMO_PREFIX = 'demo-';

export interface DemoSpec {
  members: number;
  weeks: number;
  /** 정해 두면 헌금 총 건수가 정확히 이 값(12/25·1/1 건수를 뺀 나머지를 주에 분배). 없으면 주 평균(weekMean)으로 정함 */
  total?: number;
  weekMean: number;
  weekMin: number;
  weekMax: number;
  /** 12/25·1/1 날짜 하루에 더해지는 건수 */
  spikeCount: number;
}

/** 데스크톱 앱: 성도 800명 · 헌금 20만 건(3년, 주 750~2,000건, 12/25·1/1은 하루 5,000건 추가) */
export const DEMO_SPEC_APP: DemoSpec = { members: 800, weeks: 156, total: 200_000, weekMean: 1090, weekMin: 750, weekMax: 2000, spikeCount: 5000 };
/** 브라우저(휴대폰 포함): 성도 800명 · 헌금 약 6.3만 건(최근 18개월, 주 500~1,333건, 12/25·1/1은 하루 3,333건 추가). 브라우저는 저장·메모리 여유가 적고 시연용이라 더 작게 만듭니다. */
export const DEMO_SPEC_BROWSER: DemoSpec = { members: 800, weeks: 78, total: 63_000, weekMean: 727, weekMin: 500, weekMax: 1333, spikeCount: 3333 };

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

/** allocate에 항목별 상한(cap)을 둡니다: 넘는 몫은 상한에 묶고 나머지 항목에 다시 나눕니다. */
export function allocateCapped(total: number, weights: readonly number[], cap: number): number[] {
  const out = weights.map(() => 0);
  let free = weights.map((_, i) => i);
  let left = total;
  while (left > 0 && free.length) {
    const part = allocate(left, free.map((i) => weights[i]));
    const next: number[] = [];
    left = 0;
    free.forEach((i, k) => {
      const room = cap - out[i];
      if (part[k] > room) {
        out[i] = cap;
        left += part[k] - room;
      } else {
        out[i] += part[k];
        next.push(i);
      }
    });
    free = next;
  }
  return out;
}

function buildMembers(rnd: () => number, count: number): Member[] {
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
  while (members.length < count) {
    const size = Math.min(count - members.length, pick([1, 2, 2, 3, 3, 4, 5]));
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

export interface DemoPlan {
  members: Member[];
  offeringTypes: BackupPayload['offeringTypes'];
  /** 헌금이 있는 달('YYYY-MM', 오래된 순) */
  months: string[];
  /** 헌금 총 건수 */
  total: number;
  /** 한 달씩 만들어 넘깁니다(최근 달부터 — 먼저 쓸 수 있게). 메모리는 한 달치 */
  generate(): Generator<{ ym: string; donations: Donation[] }>;
}

/** 날짜별 건수를 정하고(가벼움) 달별로 헌금을 만드는 계획을 세웁니다. */
export function planDemo(spec: DemoSpec = DEMO_SPEC_APP, today: Date = seoulNow(), seed = 20261116): DemoPlan {
  const rnd = rngOf(seed);
  const members = buildMembers(rnd, spec.members);
  const activeMembers = members.filter((m) => m.isActive);
  const offeringTypes = DEFAULT_OFFERING_TYPES.map((t, i) => ({ ...t, id: `${DEMO_PREFIX}t-${i + 1}` }));
  const typeWeights = TYPE_MIX.map((t) => t.weight);

  // 날짜별 건수: 주마다(일~토) 1,500~4,000건을 일요일 70%·나머지 요일 30%로, 12/25·1/1 날짜는 하루에 spikeCount 추가
  const todayStr = ymd(today);
  const lastSun = parseYmd(lastSunday(today));
  const firstSun = addDays(lastSun, -7 * (spec.weeks - 1));
  const spikes = new Set<string>();
  for (let y = firstSun.getFullYear(); y <= today.getFullYear(); y++) {
    for (const md of ['01-01', '12-25']) {
      const d = `${y}-${md}`;
      if (d >= ymd(firstSun) && d <= todayStr) spikes.add(d);
    }
  }
  const total = spec.total ?? Math.round(spec.weeks * spec.weekMean) + spikes.size * spec.spikeCount;
  const weekSum = total - spikes.size * spec.spikeCount;
  // 주 편차: 한쪽으로 치우친 난수 비중(많은 주는 드물게), 최소 weekMin 보장 + 나머지를 상한까지만 나눔
  const extra = allocateCapped(weekSum - spec.weeks * spec.weekMin, Array.from({ length: spec.weeks }, () => 0.05 + rnd() ** 3), spec.weekMax - spec.weekMin);
  const perDate = new Map<string, number>();
  for (let i = 0; i < spec.weeks; i++) {
    const sun = addDays(lastSun, -7 * i);
    const days = [0, 1, 2, 3, 4, 5, 6].map((k) => ymd(addDays(sun, k))).filter((d) => d <= todayStr);
    const counts = allocate(spec.weekMin + extra[i], days.map((_, k) => (k === 0 ? 70 : 30 / Math.max(1, days.length - 1))));
    days.forEach((d, k) => perDate.set(d, (perDate.get(d) ?? 0) + counts[k]));
  }
  for (const d of spikes) perDate.set(d, (perDate.get(d) ?? 0) + spec.spikeCount);

  const byMonth = new Map<string, string[]>();
  for (const d of [...perDate.keys()].sort()) (byMonth.get(d.slice(0, 7)) ?? byMonth.set(d.slice(0, 7), []).get(d.slice(0, 7))!).push(d);
  const months = [...byMonth.keys()];

  function* generate(): Generator<{ ym: string; donations: Donation[] }> {
    const gen = rngOf(seed + 1);
    const order = activeMembers.map((_, i) => i);
    let seq = 0;
    for (const ym of [...months].reverse()) {
      const donations: Donation[] = [];
      for (const date of byMonth.get(ym)!) {
        const n = perDate.get(date)!;
        // 같은 날·같은 성도·같은 종류는 한 건이라는 앱 규칙에 맞게, 성도 헌금은 종류마다 서로 다른 성도에서 뽑고 나머지는 무명/방문자로 채웁니다.
        const memberRows = Math.min(Math.round(n * 0.85), Math.floor(activeMembers.length * typeWeights.length * 0.5));
        const perType = allocate(memberRows, typeWeights).map((c) => Math.min(c, activeMembers.length));
        let i = 0;
        const stamp = (k: number): string => `${date}T${pad2(9 + Math.floor(k / 3600) % 12)}:${pad2(Math.floor(k / 60) % 60)}:${pad2(k % 60)}.${String((k * 7) % 1000).padStart(3, '0')}Z`;
        perType.forEach((c, ti) => {
          for (let k = 0; k < c; k++) {
            const j = k + Math.floor(gen() * (order.length - k)); // 부분 섞기로 서로 다른 성도 c명
            [order[k], order[j]] = [order[j], order[k]];
            const m = activeMembers[order[k]];
            donations.push({
              id: `${DEMO_PREFIX}d-${(++seq).toString(36).padStart(6, '0')}`,
              date,
              memberId: m.id,
              donorDisplayName: m.name,
              familyGroupIdSnapshot: m.familyGroupId ?? null,
              offeringTypeId: offeringTypes[ti].id,
              amount: TYPE_MIX[ti].amounts[Math.floor(gen() * TYPE_MIX[ti].amounts.length)],
              createdAt: stamp(i++),
            });
          }
        });
        for (let a = 1; i < n; a++) {
          let r = gen() * typeWeights.reduce((s, w) => s + w, 0);
          let ti = 0;
          while (ti < typeWeights.length - 1 && (r -= typeWeights[ti]) > 0) ti++;
          donations.push({
            id: `${DEMO_PREFIX}d-${(++seq).toString(36).padStart(6, '0')}`,
            date,
            memberId: null,
            donorDisplayName: `무명${a}`,
            familyGroupIdSnapshot: null,
            offeringTypeId: offeringTypes[ti].id,
            amount: TYPE_MIX[ti].amounts[Math.floor(gen() * TYPE_MIX[ti].amounts.length)],
            createdAt: stamp(i++),
          });
        }
      }
      yield { ym, donations };
    }
  }

  return { members, offeringTypes, months, total, generate };
}

/** 수정/삭제 이력 6건(주어진 최근 내역에서 고름) */
export function buildDemoAudits(recent: readonly Donation[], seed = 20261116): Record<string, AuditLog[]> {
  const rnd = rngOf(seed + 2);
  const out: Record<string, AuditLog[]> = {};
  if (recent.length === 0) return out;
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
    (out[d.date.slice(0, 4)] ??= []).push(log);
  }
  return out;
}

/** 전체를 한 번에 만든 백업 형태(작은 규모의 시험용). 큰 규모는 planDemo로 한 달씩 처리하세요. */
export function buildDemoPayload(spec: DemoSpec = DEMO_SPEC_APP, today: Date = seoulNow()): BackupPayload {
  const plan = planDemo(spec, today);
  const donationsByYear: Record<string, Donation[]> = {};
  let last: Donation[] = [];
  for (const { donations } of plan.generate()) {
    if (last.length === 0) last = donations; // 첫 달 = 가장 최근 달
    for (const d of donations) (donationsByYear[d.date.slice(0, 4)] ??= []).push(d);
  }
  return { members: plan.members, offeringTypes: plan.offeringTypes, donationsByYear, auditLogsByYear: buildDemoAudits(last) };
}
