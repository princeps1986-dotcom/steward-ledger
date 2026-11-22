# 청지기 장부 — 아키텍처 명세서 v1.0

> 오프라인 우선 교회 헌금 회계 데스크톱 앱의 **구조와 설계 결정**을 설명합니다.
> 무엇을 만드는지는 [PRD.md](PRD.md), 사용법은 앱 안의 [설명서]를 보세요.

## 목차
1. [한눈에 보기](#1-한눈에-보기)
2. [설계 원칙](#2-설계-원칙)
3. [기술 스택](#3-기술-스택)
4. [코드 구조](#4-코드-구조)
5. [데이터 모델](#5-데이터-모델)
6. [저장소 설계](#6-저장소-설계)
7. [화면 데이터 관리 (DonationContext)](#7-화면-데이터-관리-donationcontext)
8. [보고서](#8-보고서)
9. [PDF 저장](#9-pdf-저장)
10. [백업 · 복원 · 초기화](#10-백업--복원--초기화)
11. [입력 화면 설계](#11-입력-화면-설계)
12. [인쇄, 테마, 달력](#12-인쇄-테마-달력)
13. [Electron 셸](#13-electron-셸)
14. [저장소 버전](#14-저장소-버전)
15. [성능 측정과 설계 근거](#15-성능-측정과-설계-근거)
16. [테스트](#16-테스트)
17. [알려진 한계](#17-알려진-한계)
18. [빌드 · 실행 · 배포](#18-빌드--실행--배포)

---

## 1. 한눈에 보기

```text
┌─────────────── Electron (main.cjs, preload.cjs) ───────────────┐
│  단일 인스턴스 잠금 · CSP · 자동 백업 파일 쓰기 · 파일 열기      │
│  ┌────────────────── 렌더러 (React 19 + Vite) ──────────────┐  │
│  │ components (보기만)  ←  hooks (화면 로직)                  │  │
│  │                         ↓                                  │  │
│  │ contexts (상태)  →  services (규칙·저장·백업)          │  │
│  │                         ↓                                  │  │
│  │ Dexie → IndexedDB (이 PC 안에만 저장)                       │  │
│  └────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

서버·네트워크가 없습니다. 모든 데이터는 렌더러의 IndexedDB에 있고, 같은 코드가 일반 브라우저(시연용 GitHub Pages, 개발용)에서도 그대로 동작합니다.

## 2. 설계 원칙

1. **오프라인 우선:** 외부 API·서버 없이 로컬에서 즉시 영구 저장.
2. **로직과 보기의 분리:** `components/`의 `.tsx`에는 비즈니스 로직이 없고 값과 이벤트 핸들러를 연결만 합니다. 판단·상태는 `hooks/`, 규칙은 `services/domain/`(순수 함수, 단위 테스트 대상).
3. **필요한 곳만 다시 그리기:** `use-context-selector`로 값이 바뀐 조각을 구독하는 컴포넌트만 렌더링합니다.
4. **전부 아니면 전무:** 여러 키를 바꾸는 작업은 IndexedDB 트랜잭션(Dexie) 하나로 원자적으로 처리합니다.
5. **회계 정합성:** 모든 수정·삭제는 이력(AuditLog)에 남고, 납부 당시 세대 정보(스냅샷)를 보존합니다.
6. **보안:** `script-src 'self'` CSP, XSS 방어. 단 가상 스크롤 좌표·인쇄 레이아웃을 위한 제한적 인라인 스타일(`style={{…}}`)은 허용합니다.
7. **라이선스:** 상업적 이용이 자유로운 MIT 계열 패키지만 사용합니다.
8. **연타·경합에 안전:** 사용자의 반복 입력과 비동기 읽기·쓰기 겹침에도 중복 실행·옛 값 덮어쓰기가 없어야 합니다(7장, 11장).

## 3. 기술 스택

| 분류 | 사용 | 이유 |
| :--- | :--- | :--- |
| 기반 | React 19 + TypeScript + Vite | 정적 타입, 빠른 빌드 |
| 저장 | Dexie (IndexedDB) | 트랜잭션, 범위 조회, 행 단위 저장·색인 |
| 상태 | use-context-selector | 전역 리렌더링 방지 |
| 스타일 | Tailwind CSS 4 + Radix UI(Dialog) | 접근성 있는 헤드리스 대화상자 |
| 가상 스크롤 | @tanstack/react-virtual | 수천 행에서도 보이는 행만 그림 |
| CSV | papaparse | 명단 불러오기 (CP949는 `TextDecoder('euc-kr')`) |
| 날짜 | date-fns | 날짜 계산 |
| 달력 | 자체 `DatePicker` | 브라우저 기본 달력은 일요일을 빨갛게 칠할 수 없음 |
| 데스크톱 | Electron 45 + electron-builder(NSIS) + electron-updater | Windows 설치 파일, 누를 때만 확인하는 업데이트 |
| 테스트 | Vitest, fake-indexeddb, jsdom, @testing-library/react | 저장소·화면 상태까지 자동 검증 |

## 4. 코드 구조

기능별로 어느 파일을 보면 되는지는 [docs/CODE_MAP.md](docs/CODE_MAP.md)에 따로 정리했습니다(파일을 옮기거나 이름을 바꾸면 함께 고칩니다).

```text
src/
├── main.tsx            시작: 저장소 열기 → 화면 렌더 (실패 시 오류 안내)
├── App.tsx             메뉴, 페이지 전환
├── contexts/           [상태] 데이터 보관과 변경
│   ├── DonationContext.tsx   헌금: 달 단위 메모리 모델, 저장·수정·삭제·복구하기
│   ├── MemberContext.tsx / OfferingTypeContext.tsx / SettingsContext.tsx
│   ├── AppProviders.tsx      위 컨텍스트를 한 번에 묶음
│   └── types.ts              데이터 모델·앱 버전·스키마 버전
├── hooks/              [화면 로직] useDonationInput, useDonationEditor, useReports·useReportFilters,
│                       useMembersPage, useMemberForm, useSettingsPage, usePaging(쪽 이동),
│                       useNameTag(표기명 옆 표기), exclusive(연타 방지) …
├── services/
│   ├── domain/         [순수 규칙] 금액·검색·세대·집계·월 캐시 …
│   ├── storage/        db(Dexie 정의)·storageService(트랜잭션·월 키), tabSyncChannel(창 간 동기화)
│   ├── backup/         backupService, streamRestore(줄 단위 복원), mergeRules, validation(체크섬·버전 변환), sha256, autoBackupService, backupBusy
│   ├── downloadBridge.ts  파일 내려받기(브라우저)
│   ├── errorMessage.ts    오류를 사용자 문구로 바꿈
│   ├── import/         memberImportService (CSV 명단)
│   ├── demo/           demoData (시연 데이터)
│   └── theme.ts, desktopBridge.ts
└── components/
    ├── shared/         DatePicker, Modal, Notice, ThemePicker, MemberFormFields, MemberPicker, Pager, ErrorBoundary …
    └── pages/          donation-input · reports · members · offerings · settings · help
electron/               main.cjs(창·백업 IPC), preload.cjs(노출 API), backupCrypto.cjs(백업 암호화), backupVerify.cjs(백업 검증), restoreLog.cjs(복원 기록), dataPaths.cjs(데이터 폴더)
scripts/                testdata-core.mjs(생성 규칙), generate-test-data.mjs(파일 생성), smoke.mjs(스모크 시험), dev-app.mjs(개발 서버 + Electron 창)
.github/workflows/      pages.yml (시연 페이지 자동 배포)
```

`pages/help`의 `helpContent.ts`는 설명서의 정적 데이터이며(섹션 → 항목 → 문단, 마지막 섹션은 문제 해결 FAQ), **기능이 바뀌면 이 파일도 함께 고칩니다.** 검색은 `useHelpPage`가 검색어(공백 제외, 대소문자 무시)를 항목 제목·본문에서 찾아 일치하는 항목만 남겨 목차와 본문에 돌려줍니다(저장·색인 없음).

## 5. 데이터 모델

`src/contexts/types.ts`

```typescript
interface Member {            // 성도
  id: string; name: string;
  position: string;           // 직분. 빈 값 = 없음 ('성도'는 직분이 아님)
  phoneLast4?: string;        // 동명이인 구분
  familyGroupId?: string;     // 세대 그룹 = 최초 세대주의 id (세대주가 바뀌어도 유지)
  isFamilyHead: boolean;
  isActive: boolean;          // false = 비활성화(과거 통계 보존)
  createdAt: string; updatedAt: string;
}

interface OfferingType {      // 헌금 종류
  id: string; name: string;
  displayArea: 'PRIMARY' | 'DROPDOWN';   // 기본 나열 / 기타 선택
  quickAmounts: number[];                // 자주 쓰는 금액 단추
  sortOrder: number; isActive: boolean;
}

interface Donation {          // 헌금 1건 (종류별 1건)
  id: string;
  date: string;               // YYYY-MM-DD — 저장 위치(달)를 정하는 기준
  memberId: string | null;    // 무명·방문자는 null
  donorDisplayName: string;   // '김철수', '무명1', '방문자-홍길동'
  familyGroupIdSnapshot?: string | null;  // 입력 당시 세대 (연말정산 이력 보존)
  offeringTypeId: string; amount: number; // 원 단위 정수
  memo?: string; createdAt: string;
}

interface AuditLog {          // 수정·삭제 이력
  id: string; targetId: string;
  action: 'UPDATE' | 'DELETE';
  beforeSnapshot: Donation; afterSnapshot: Donation | null;
  reason: string;             // 필수(합산·복구하기는 자동 기입)
  timestamp: string;
}

interface BackupEnvelope {    // 백업 파일
  appVersion: string;         // 현재 "1.0.0"
  schemaVersion: number;      // 현재 2
  exportedAt: string;
  checksum: string;           // payload의 SHA-256
  payload: { members; offeringTypes;
             donationsByYear: Record<'YYYY', Donation[]>;
             auditLogsByYear: Record<'YYYY', AuditLog[]> };
}
```

* 한 번의 저장(봉투)은 종류마다 독립된 `Donation`을 만듭니다(묶음 ID 없음). 같은 날짜·성도·종류의 중복 감지도 기록 단위입니다.
* 세대 그룹은 별도 엔티티 없이 세대주의 `Member.id`를 그룹 ID로 씁니다. 세대주 변경은 `isFamilyHead`만 옮기고, 분가·이동해도 과거 기록은 스냅샷 덕분에 영향이 없습니다.
* **백업 형식:** 지금 만드는 파일은 줄 단위 v3(§10, `NDJSON_VERSION` 3)입니다. 위 봉투 형식(`schemaVersion` 2, 연도별 `donationsByYear`)은 예전 파일이며, 복원할 때 자동으로 읽습니다.

## 6. 저장소 설계

`services/storage/storageService.ts`

### 6.1 키 구성
| 키 | 내용 |
| :--- | :--- |
| `members`, `offering_types`, `settings` | 성도 / 헌금 종류 / 설정 |
| (테이블 `donations`) | **한 건이 한 행**인 헌금. 기본키 `[date, id]`, 색인 `memberId`·`offeringTypeId`·`[date+memberId+offeringTypeId]`. 쓰기 목록(`Write`)의 `donations_YYYY-MM` 키는 '그 달의 행이 바뀐다'는 표시일 뿐 값은 저장되지 않음 |
| (테이블 `audits`, v2) | **한 건이 한 행**인 수정·삭제 이력. 기본키 자동 증가 `seq`(기록 순서), 색인 `year`. `audit_logs_YYYY` 키는 '그 해의 이력'을 가리키는 이름이며 `getItem`이 그 해 행을 배열로 모아 돌려줌. 쓰기는 `auditAppend`(행만 덧붙임; 저장·수정·삭제·복구하기) 또는 값 교체(그 해 전체; 복원·초기화·시연) |
| `meta_dirty_since_backup` | 마지막 백업 이후 데이터가 바뀌었는지(백업 대상 아님) |
| `meta_dirty_years` | 마지막 전체 백업 이후 헌금·이력이 바뀐 연도 목록(주기 백업이 그 연도만 담음, 전체 백업 때 지움, 백업 대상 아님) |

한 건을 저장·수정·삭제하면 **그 행만** 씁니다(`rowWrite`; 날짜가 바뀌면 이전 행을 지우고 새 행을 만듦). 달 전체 교체(`monthWrite`)는 백업 복원에서만 씁니다. 월 1.2만 건에서 저장이 월 배열 방식 약 35ms → 0.6ms입니다(fake-indexeddb 측정).

### 6.2 원자적 트랜잭션 (`transact`)
구현: `src/services/storage/storageService.ts`의 `transact`.
1. IndexedDB 쓰기 트랜잭션 하나를 연다(`db.transaction('rw', db.kv, …)`).
2. 그 안에서 읽기 함수로 값을 읽어 **쓸 목록(writes)을 계산**한다.
3. 쓸 목록(같은 키는 마지막 쓰기만)을 `bulkPut`·`bulkDelete`로 한 번에 쓴다. 데이터 키가 바뀌면 '마지막 백업 이후 변경' 표시도 같은 트랜잭션에 쓴다.
4. 커밋되면 다른 창에 바뀐 키를 알린다.

도중에 오류가 나거나 앱이 멈추면 **트랜잭션 전체가 취소**되어 아무것도 바뀌지 않습니다(행 테이블과 `kv`의 쓰기가 한 트랜잭션입니다).

주의: `build` 안에서는 `read`와 `storageService`의 읽기 함수(`getItem`·`getMany`·`readMonth`·`readRow` 등)만 기다려야 합니다. 그 밖의 비동기 작업(`fetch`, 해시 계산 등)을 기다리면 IndexedDB 트랜잭션이 먼저 끝나 버립니다.

**저장소 구조(버전 2):** 데이터베이스 `church-offering-ledger`

| 테이블 | 내용 |
| :--- | :--- |
| `kv` | 성도·헌금 종류·설정·백업 표시 |
| `donations` | 헌금 한 건이 한 행. 기본키 `[date, id]`라 월·연 로드가 날짜 범위 읽기(월 1.2만 건에서 약 43ms) |
| `audits` | 이력 한 건이 한 행 |

* 색인 `memberId`·`offeringTypeId`·`[date+memberId+offeringTypeId]`로 중복 검사(약 0.1ms)와 헌금 종류 사용 수를 셉니다. 한 달 안의 표시 순서는 입력 시각(`createdAt`) 순입니다.
* v1→v2 업그레이드는 `kv`의 `audit_logs_YYYY` 배열을 기록 순서대로 `audits` 행으로 옮기고 키를 지웁니다(업그레이드 트랜잭션 하나). v1은 수정할 때마다 그 해 이력 배열 전체를 다시 썼습니다.
* v2로 연 데이터는 v1 앱이 열 수 없습니다(더 새로운 버전 안내). 아직 실제 사용 데이터가 없는 개발 단계라 이전 형식(localForage·월 배열)에서 옮기는 코드는 두지 않았습니다.

### 6.3 연도 경계 수정
날짜를 고쳐 월·연도가 바뀌면 한 트랜잭션에서 ① 이전 달에서 제거 ② 새 달에 삽입 ③ 새 연도 이력에 기록합니다.

## 7. 화면 데이터 관리 (DonationContext)
구현: `src/contexts/DonationContext.tsx`.

### 7.1 달 단위 메모리 모델
* 상태: `months: Record<'YYYY-MM', Donation[]>`, `epoch`(전체 다시 읽기 때 +1), `audits`, `years`, `history`(최근 저장 10건, 메모리 전용).
* **저장 시 그 달 배열만 교체**하고 다른 달 배열은 같은 객체를 유지합니다. 이를 소비하는 훅(`useDonationMonths`)은 달 배열이 바뀌지 않으면 같은 결과 배열을 돌려주므로 다른 달에 저장해도 집계가 다시 계산되지 않습니다.
* 화면은 필요한 달만 불러옵니다: 주별 1~2달, 일별 1달, 월별 1달, 분기 3달, 연도 12달, 입력 화면은 선택일의 달. 분기·연도 요약은 내역을 메모리에 올리지 않고 달마다 헌금 종류별 합계만 구해 쓰며(`useMonthSums`, 달 버전이 같으면 캐시 재사용) 다른 기간은 기존대로 달 내역을 읽습니다.

### 7.2 연도 해제
화면이 쓰는 연도는 `pinMonths`로 “사용 중” 표시하고, `evictOldYears`가 순수 함수 `yearsToEvict`로 **메모리에 올린 내역을 합쳐 50만 건(약 150MB) 이하**로 유지합니다(연도 수가 아니라 건수 기준이며 마지막 사용이 오래된 연도부터 해제). 화면이 연도를 놓을 때(예: 보고서에서 입력 화면으로 이동)는 예산을 10만 건으로 낮춰 큰 연도를 바로 내립니다. 한 연도의 달은 동시에 읽되(차례로 읽기와 비교 측정: 최대 메모리 같고 읽기 1.7초 vs 2.1초) 화면에는 한 번에 반영하며(달마다 반영하면 보고서가 그때마다 다시 집계됨; 연 26만 건 실측: 로딩 3.6초·화면 갱신 13회 → 2.3초·3회), 일시적인 최대 메모리를 낮추며, `readMonth`는 같은 값의 문자열(성도 번호·종류·날짜·표기명)을 하나로 합쳐 행당 메모리를 줄입니다(시험 데이터 기준 314B → 184B). 사용 중이거나 읽는 중인 연도는 내리지 않으며, 요청한 연도는 가장 최근 사용으로 칩니다. 필요하면 다시 읽습니다.

### 7.3 경합 방어
| 상황 | 방어 |
| :--- | :--- |
| 달을 읽는 도중 저장이 커밋됨 | `staleMonths`로 표시하고 다시 읽는다 |
| 읽는 도중 복원·초기화(`reloadAll`) | `generation`이 바뀌면 읽은 결과를 버린다 |
| 읽기 실패 | 빈 결과로 굳히지 않고 다음 요청 때 다시 읽는다. 보고서 합계 읽기가 실패하면 안내를 보여 주고 인쇄·PDF를 막는다(8.1) |
| 연도 목록을 여러 번 새로 읽음 | `refreshYears` 토큰으로 마지막 요청만 반영한다 |
| 저장 후 [수정]으로 달이 바뀐 내역을 복구하기 | 저장한 달을 먼저 읽고, 못 찾은 내역만 나머지 달에서 찾는다 |

### 7.4 연타 방지
React 상태(`saving`)는 다음 렌더 뒤에야 바뀌어 연타를 막지 못합니다. `hooks/exclusive.ts`의 `createExclusive(ref)`가 **진행 중에 들어온 호출을 즉시 무시**하고 끝나면(실패해도) 풀립니다. 헌금 저장(Enter·Ctrl+Enter·[저장]·큰 금액/중복 확인창)과 복구하기, 성도 등록·수정 폼에 적용합니다.

## 8. 보고서

### 8.1 선택과 계산의 분리 (250ms 지연)
`useReportFilters`는 **선택 값**(`f.sel`: 연도·기간·분기/월·주)과 **적용 값**(`f.year`, `f.periodType`, `f.periodValue`, `f.week`)을 나눕니다. 적용 값은 `useDebouncedValue`로 선택이 250ms(`REPORT_DELAY_MS`) 멈춘 뒤에 바뀝니다. 이 사이(`f.pending`)에는 “불러오는 중…” 표시와 본문 흐림, 인쇄·PDF 단추 비활성으로 **화면과 다른 기간이 저장되는 일을 막습니다.** [이전/다음 주]는 ref(`latestWeek`)로 최신 선택에서 이어 가므로 연타해도 누른 만큼 이동합니다. 연타 중에는 중간 보고서를 계산하지 않습니다(30번 연타 → 계산 1회). 합계 읽기가 실패하면(`loadFailed`) “불러오는 중”을 끝내고 안내를 보여 주며 인쇄·PDF를 막고, 선택이나 데이터가 바뀌면 다시 읽습니다.

### 8.2 종류별 표
| 기간 | 표 | 집계 |
| :--- | :--- | :--- |
| 주별 | 성도명 × 종류 | `buildWeeklyMatrix` |
| 일별 | 성도명 × 종류 | 같은 함수를 하루짜리 범위(`start=end`)로 재사용(`PeriodType` `DAY`, 날짜 상태는 주별과 공유) |
| 월별 | 성도명 × 종류 | 같은 함수를 `personRange`(그 달 1일~말일)로 재사용 → 주별 합과 일치 |
| 분기·연도 | 종류 × 월 | `useSummaryReport` |

* `ReportFilters.personKind('WEEK'|'MONTH'|null)`/`personRange`로 화면·PDF가 같은 코드를 씁니다.
* 열 = 활성 종류 + 기간에 쓰인 비활성 종류(`sortOrder` 순) + 장부에만 있는 종류(`(삭제된 종류)`, 합계 일치 보장). 행 키는 `memberId`(동명이인 분리) 또는 `anon:표기명`(같은 무명 합산).
* 정렬: 이름 → 연락처 뒷4자리(없으면 뒤) → 직분 순위 → id, 이어서 무명(번호 숫자순). 화면과 PDF가 같은 `useMemberOrderKey()`를 씁니다.
* **[표시할 헌금 종류]:** `ReportsPage`가 뒤집은 종류(`flippedIds`)만 기억하고(기본은 활성=표시) `withoutTypes`로 내역·열을 걸러 화면·인쇄·PDF가 같은 결과를 냅니다. 보고서·탭이 바뀌면 비웁니다.
* **[비활성 성도 포함]:** `ReportsPage`의 `includeInactive`(기본 true)를 `useWeeklyMatrix`·`useHasExportableData`에 넘기고, 끄면 `useDonationsForSummary`가 비활성 성도의 내역을 먼저 뺍니다(성도 행이 있는 주별·월별·일별 표 전용). `WeeklySummary`는 화면에서 `usePaging`으로 100명씩 그리고, 인쇄·PDF(`useIsPrinting`)는 모든 행을 그립니다.
* **세대 합산 조회는 연도별 보고서에서만 가능합니다.** `usePersonalReport`는 `f.periodType`이 `YEAR`가 아니면 선택값과 상관없이 개인 기준(`PERSON`)으로 조회하고, 개인 기준/세대 합산 선택 단추는 연도별에서만 보이며 다른 기간에는 안내 문구만 나옵니다.
* **세대 집계 기준**(현재/납부 당시)은 세대 합산 조회에서만 쓰이며 개인별·세대별 탭이 직접 토글을 보여 줍니다(상태 `f.basis`는 `useReportFilters`). 종합 보고서와 PDF 파일명에는 쓰이지 않습니다. 세대 합산 결과 위에는 `currentHeadOf`로 구한 현재 세대주를 표시합니다.
* 탭은 `reportKey`(주별·일별은 `기간:시작일`, 그 외 `기간:연도:값`)가 바뀌면 [종합 보고서]로 돌아갑니다.

### 8.3 큰 표의 속도
* **가상 스크롤:** `WeeklySummary`는 `useVirtualizer`로 보이는 행만 `<tbody>`에 그리고 위·아래를 높이만 가진 빈 행(`padTop/padBottom`)으로 채웁니다. 실제 행 높이는 `measureElement`로 재어 글자 크기 125%에서도 행이 가려지지 않으며, 합계 행은 `sticky bottom-0`로 유지됩니다. `useIsPrinting`이 `beforeprint`에서 켜지면 가상화를 끄고 **모든 행**을 그립니다.
* **전체 입력 내역:** 기간의 헌금을 메모리에 올리지 않고 달 단위로 읽습니다(`ListPager`, `useReportFilters(false)`로 이 탭에서는 기간 로딩을 끔).
  * 달마다 건수·합계만 구해 두고, 화면에 보이는 행의 달만 읽습니다. 합쳐서 5만 건까지는 행을 그대로 들고 있습니다(작은 기간은 한 번만 읽음).
  * 화면에는 **100건씩 페이징**(`usePaging`·`Pager`, 번호 이동)합니다. 다른 달로 넘어간 페이지는 그 달을 읽는 동안 "불러오는 중…" 줄로 보입니다.
  * **쪽을 옮기면 스크롤이 맨 위로 돌아갑니다.** `usePaging`이 돌려주는 `scrollRef`를 스크롤되는 목록 영역에 붙이면 `setPage`가 그 영역의 `scrollTop`을 0으로 하고 화면 밖으로 밀린 영역 위쪽도 보이게 합니다(`scrollIntoView({block:'nearest'})`). 전체 입력 내역·개인별·세대별·수정·삭제 이력·성도 정보·명단 불러오기 미리보기가 모두 같은 방식입니다.
  * 개인별·세대별(100건)·수정·삭제 이력(50건)·성도 정보(100명)도 같은 페이징을 씁니다. 이 탭들은 인쇄하지 않으므로 인쇄용 분기가 없습니다.
  * 달이 바뀌었는지는 컨텍스트의 `monthVersions`(메모리에 올리지 않은 달 포함)로 알아 바뀐 달만 다시 읽습니다. 정렬은 ISO 날짜 문자열 직접 비교입니다.
  * 측정(Chromium, 9.6만 건): 건수·합계 약 1초, JS 힙 41~45MB. 이름 검색은 부분 일치만 지원합니다.
* **메뉴 이동:** 첫 화면이 뜬 직후 다른 화면의 코드를 미리 불러와(`App.tsx`) 처음 열 때 기다리지 않습니다.
* **스크롤 영역 높이:** `useFitHeight`가 영역 위치부터 화면 아래까지 남은 높이(최소 240px)를 `--fit-h`로 정해, 위쪽 내용이 길어도 고정 합계 행이 항상 화면 안에 있습니다.
* **고정 셀:** 합계 행은 `sticky bottom-0`, 머리글 `top-0`, 번호·성도명 열 `left-0/left-10`. `border-collapse` 때문에 사라지는 윗선은 그림자(`shadow`)로 대신 그립니다.

### 8.4 수정·삭제 이력 범위
(헌금 수정창 `useDonationEditor`는 날짜·종류·금액·메모만 바꾸며 `memberId`·`donorDisplayName`·세대 스냅샷은 원본을 그대로 유지합니다. 날짜 칸은 `DatePicker`의 `pickOnly`라 달력으로만 선택하고, 성도·표기명은 읽기 전용 칸(`donorLabel`)으로만 보여 줍니다. 종류 선택 목록(`typeOptions`)은 활성 종류만이며, 현재 종류가 비활성이면 `disabled` 옵션으로만 함께 보여 줍니다.)

`auditLogsForPeriod`가 변경 전·후 날짜 중 하나라도 기간에 속하면 포함합니다(연도를 옮긴 수정은 두 보고서 모두에 나옴). 이력은 새 연도의 장부에 기록되므로 모든 연도의 이력을 불러온 뒤 거릅니다.

### 8.5 동명이인 표기
표기명 옆의 작은 괄호 표기는 `useNameTag(withPosition)`가 만듭니다.

| 화면 | 규칙 | 함수 |
| :--- | :--- | :--- |
| 전체 입력 내역 · 개인별·세대별 내역 · 수정·삭제 이력 | 직분이 있으면 항상 표기, 동명이인이면 연락처 뒷4자리를 앞에 붙임 (`1234 · 집사`) | `memberTag` |
| 주별 요약 | 동명이인일 때만 연락처 뒷4자리(없으면 직분) | `nameDisambiguator` |

`duplicateNames`가 동명이인(비활성 포함)을 찾습니다. 무명/방문자와 직분이 없는('성도' 포함) 성도는 표기가 없습니다.

## 9. PDF 저장

* [PDF 저장]은 데스크톱 앱에서 `report:save-pdf`(main의 `printToPDF`, `@page` 크기 사용)로 저장 창을 거쳐 저장하고, 웹은 `window.print()`로 대신합니다. 인쇄 전용 렌더링(`useIsPrinting`)을 위해 호출 전후에 `beforeprint`/`afterprint`를 직접 보냅니다.
* 데스크톱 앱에서는 저장 완료(`download:done`) 시 `showInFolder`로 저장 폴더를 자동으로 열고 [파일 열기]/[폴더 열기]도 보여 줍니다. `recipientEmail` 설정 필드는 저장 데이터 호환을 위해 남겨 두고 화면에서는 쓰지 않습니다.

## 10. 백업 · 복원 · 초기화

`services/backup/`

| 기능 | 함수 | 설명 |
| :--- | :--- | :--- |
| 만들기 | `collectPayload(years?)`, `createBackupJson`, `createBackupBlob(years?)`, `downloadBackup(prefix, years?)` | 선택 연도의 월 키를 연도별로 합쳐 담고 체크섬을 붙인다. 성도·종류는 항상 전부. |
| 검사 | `validation.parseAndValidateBackup` | SHA-256 체크섬과 형식 검증, 이전 스키마(v1→v2) 자동 변환 |
| 복원 | `restoreBackup(payload, {years, mode})` | 화면은 `mode: 'YEARS'`, 연도 하나 |
| 전체 교체 | `replaceAllData(payload)` | 시연 데이터·초기화용(단일 트랜잭션, 큰 데이터에는 한도 있음) |
| 초기화 | `resetAllData()` | 빈 성도·내역·이력 + 새 id의 기본 헌금 종류로 교체(설정 유지) |
| 자동 백업 | `autoBackupService` | 종료 시 변경이 있으면 전체 백업을 **줄 단위 JSON(v3, `ndjson`)**으로 만들어 저장, 최근 10개 보관. 렌더러가 `backupLines()`로 한 달치씩 만들어 `autoBackupWrite`로 보내면 main이 SHA-256을 이어 계산하며 gzip한 뒤 암호화해(`backup_….slbk`) 바로 쓰고 마지막 줄에 해시를 붙임(메모리가 데이터 크기와 무관). 복원 화면은 `DecompressionStream`으로 `.gz`를 읽고 `parseNdjson`이 끝 줄 해시를 확인. 웹 브라우저의 직접 백업은 `createBackupBlob`이 달마다 만든 줄을 Blob으로 이어 붙이고 끝 줄에 해시를 붙인 줄 단위 파일로 내려받음 |

### 10.1 연도 복원(YEARS)과 다른 PC 백업 병합
한 트랜잭션에서 ① 선택 연도의 기존 월 키·이력 키를 지우고 ② 백업 내용을 월별로 쓰고 ③ 성도·종류를 **현재 데이터와 대응**시킵니다. 대응 규칙(`mergeRules.planMerge`)은 다음과 같습니다.

| 대상 | 같은 것으로 보는 조건 | 아닐 때 |
| :--- | :--- | :--- |
| 헌금 종류 | id 같음 또는 **이름 같음** | 새 종류로 추가 |
| 성도 | id 같음 또는 **이름 + 연락처 뒷4자리 같음** | 새 성도로 추가 (이름만 같으면 동명이인일 수 있어 합치지 않음) |

대응된 백업 id는 `remapDonations`/`remapAudits`로 **현재 id로 바꿔** 헌금·이력(스냅샷 포함)에 쓰므로 중복 없이 올바른 성도·종류에 연결됩니다. 새로 추가되는 성도의 세대 그룹이 대응된 성도를 가리키면 현재 id로 바꿉니다. `previewMerge`가 복원 창에 연결·추가·동명이인 가능 수를 미리 보여 줍니다.

### 10.2 원칙
* 전체 초기화는 자동 백업을 하지 않습니다(예전의 긴급 백업 `emergency_before_reset_*`은 없어졌고, 이미 만든 그 파일은 지우지 않고 남겨 둡니다). 확인창이 마지막 전체 백업 시각을 보여 주고 필요하면 사용자가 먼저 직접 백업합니다. 시연 데이터는 데이터가 없을 때만 만들 수 있어 백업하지 않습니다. 직접 백업·복원이 진행되는 동안에는 `backupBusy`가 잠금을 잡아 자동 백업(주기·종료)이 건너뛰며(main은 백업 세션을 하나만 두어 겹치면 진행 중이던 쪽이 취소됨), 복원 중에는 화면을 `RestoringOverlay`로 덮고 헌금 저장·수정·삭제·복구하기도 막습니다. 연도 복원은 자동 백업 없이, 확인 창에서 “선택한 연도”만 바뀐다는 점을 강조하며 사용자가 필요하면 먼저 직접 백업합니다. 백업 저장은 확인 창에서 연도를 선택하게 합니다.
* **전체 초기화 비활성:** 시연 데이터가 있거나, 성도·헌금 내역이 없고 헌금 종류도 기본값(`DEFAULT_OFFERING_TYPES`) 그대로이면 단추·핸들러(`hasData`) 모두 막습니다. **시연 제거 비활성:** 만드는 동안은 단추·핸들러·`removeDemoData` 세 곳에서 막습니다.
* **정렬 비교:** `services/domain/compare.ts`의 공유 `Intl.Collator`(`compareKo`·`compareKoNumeric`)와 고정 형식 문자열용 `compareFixed`를 씁니다(`localeCompare`를 매번 부르지 않음). 성도 정보 검색어는 `useDeferredValue`로 입력 반응을 우선합니다.
* 복원은 화면에서 연도 하나씩 선택하는 방식을 유지합니다. Dexie 트랜잭션에서는 값이 키마다 따로라 그 한도 문제는 없습니다.
* 연도 하나 백업이 저장소 전체와 같을 때만 “마지막 백업” 기록을 갱신합니다(`isCompleteYearBackup`).
* 설정은 백업에 포함되지 않으므로 복원해도 그대로 유지됩니다.
* **주기 백업:** 종료 때만 백업하면 비정상 종료 시 그날 입력분을 잃을 수 있어, 앱을 쓰는 동안 변경이 있으면 10분마다 백업합니다(`runPeriodicBackup`).
  * 진행·완료는 오른쪽 아래 `AutoSaveToast`로 보입니다. 다른 백업이 끼어들어 취소된 것은 실패로 알리지 않고 다음 주기에 재시도합니다.
  * **읽기 방식:** 데이터를 읽기 트랜잭션 하나로 붙잡지 않고 달마다 짧게 나누어 읽고 바로 파일로 흘려 보냅니다(`streamBackup`, 메모리는 한 달치). 한 트랜잭션으로 읽으면 5년 130만 건에서 읽는 동안(약 8초) 저장이 기다려 입력이 멈췄습니다(측정: 저장 6.6초 지연 → 나눠 읽으면 중앙값 110ms, 최대 163ms).
  * **일관성:** 읽는 도중 내역이 달을 넘어 옮겨졌거나 복원이 있었다면(`structuralCommitCount`가 바뀜) 중복·누락이 생길 수 있어 다시 읽습니다(최대 3번). 같은 달 안의 추가·수정·삭제는 어느 시점에 읽어도 일관되므로 그대로 둡니다.
  * **변경 표시:** 읽기 전에 먼저 내려 백업 중 생긴 변경이 다음 백업에 담기게 하고, 실패하면 복구합니다.
  * **보관과 범위:** 파일은 `autosave_*`로 종료 때 백업(`backup_*`)과 따로 최근 3개만 보관합니다. 주기 백업은 `dirtyYearsSinceFullBackup`이 돌려주는 '마지막 전체 백업 이후 바뀐 연도'만 담고(`clearDirty(false)`로 변경 표시만 내리고 연도 목록은 남겨 다음 주기에도 이어 담음, 연도를 모르면 전체), 종료 때 백업은 항상 전체여서 `clearDirty()`가 연도 목록까지 지웁니다.
* **백업 검증:** main이 자동 백업 파일을 쓴 뒤 다시 읽어 끝 줄의 SHA-256을 확인하고(`electron/backupVerify.cjs`의 `verifyBackupFile`), 맞을 때만 이름을 바꿔 확정합니다. 실패하면 임시 파일을 지우고 오류로 알립니다(이미 있는 좋은 백업은 그대로).
* **백업 세션 번호:** 주기·종료·직접 백업이 겹쳐도 줄이 섞이지 않도록 `backupBegin`이 세션 번호를 돌려주고 write·end가 그 번호를 요구합니다(새 백업이 시작되면 이전 세션은 취소). 종료 때 주기 백업이 진행 중이면 종료 백업은 '변경 없음'으로 건너뛰지 않습니다.
* **전역 오류 안내:** 처리되지 않은 오류·Promise 거부는 `GlobalErrorBanner`가 화면 위쪽에 보여 줍니다(저장소 오류는 `StorageError` 한글 문구 그대로).
* **직접 백업:** 데스크톱 앱에서는 같은 스트리밍 세션(`backupBegin` kind `manual`)으로 줄 단위 `.slbk`에 씁니다(사용자 암호로 잠금). 큰 데이터를 한 문자열로 만들 때의 한도(약 512MB)와 메모리 2~3배 사용을 피합니다. 브라우저·데모는 기존 JSON 내려받기입니다.
* **백업 암호화(.slbk, `electron/backupCrypto.cjs`):** 데스크톱 앱의 백업은 줄 단위 v3 내용을 gzip한 바이트를 1MB 조각마다 AES-256-GCM으로 암호화합니다. 머리말 `SLBK`+버전+방식, 조각은 길이·마지막 표시·IV·암호문+태그이고, 인증 데이터에 머리말·조각 번호·마지막 표시를 넣어 바꿔치기·순서 바꾸기·잘라내기를 막습니다(끝 줄 SHA-256 검사는 그대로).
  * **자동 백업 = PC 키:** main이 처음 쓸 때 32바이트 무작위 키를 만들어 `safeStorage`(Windows DPAPI)로 잠근 뒤 `userData\backup-key.bin`에 둡니다. 머리말에 키 식별값(키 SHA-256 앞 8바이트)을 넣어, 다른 PC·Windows 재설치 전의 파일이면 손상이 아니라 '다른 PC' 안내를 합니다. 키 파일을 풀 수 없으면 `.old`로 남기고 새 키를 만듭니다. 설치 파일·저장소에는 키가 없습니다.
  * **직접 백업 = 사용자 암호:** PBKDF2-SHA256 60만 회(파일마다 salt)로 키를 만들며 앱은 암호를 저장하지 않습니다. 다른 PC에서도 암호로 복원됩니다.
  * **복원:** 화면은 키를 모릅니다. `backup:inspect-file`로 종류(일반·PC 키·암호)를 확인하고, `backup:verify-file`(암호 포함)로 main이 풀어서 체크섬을 확인한 뒤, `backup:open-reader`/`read`/`close-reader`로 main이 풀어 준 평문 조각을 `decryptedBackup` 래퍼(`ReadableBackup`)로 읽어 기존 `scanBackupFile`·`restoreFromFile`을 그대로 씁니다. 예전 `.json`·`.json.gz`도 그대로 복원됩니다. 웹 버전은 암호화하지 않습니다.
* **줄 단위 복원(streamRestore):** 줄 단위 백업(.slbk/.json/.json.gz)은 파일째 읽지 않고 흘려 읽습니다. 1단계 `scanBackupFile`이 파일 전체를 읽으며 증분 SHA-256(`sha256.ts`; WebCrypto는 조각 입력이 안 됨)과 줄별 형식을 검증하고 연도별 건수를 셉니다(아무것도 쓰지 않음). 2단계 `restoreFromFile`이 검증된 파일을 다시 읽으며 달마다 따로 저장합니다(메모리는 한 달치). 달마다 따로 저장하므로 전체가 한 트랜잭션은 아니며, 시작 트랜잭션에서 `meta_restore_in_progress` 표시를 남기고 끝에 지웁니다. 중간에 꺼지면 표시가 남아 다음 실행 때 상단 안내로 알리고(같은 백업으로 다시 복원), 전체 교체(`replaceAllData`: 시연·초기화)도 표시를 지웁니다. 한 덩어리 JSON(예전 형식)은 기존처럼 전체를 읽어 한 트랜잭션으로 복원합니다.
* **시연 중 백업 차단:** 시연 데이터가 있거나 만드는 중이면(`isDemoBusy`) 자동 백업(종료 시 `buildAutoBackup`·10분 `runPeriodicBackup`)은 아무것도 하지 않고(null), 수동 백업·복원(`saveBackupFile`·`restoreBackup`·`restoreFromFile`)은 오류로 거부하며(`assertNoDemo`), 설정 화면의 백업·복원·자동 백업 컨트롤은 비활성, 백업 권고 배너는 숨깁니다. 시연 생성 직전 백업과 시연 제거 복구는 시연 흐름의 일부라 막지 않습니다.
* **시연 데이터(`demo/`):** [시연 데이터 생성]은 오늘 이전 3년(156주)을 주 단위로 나누어 만듭니다(`planDemo`, 고정 시드; 주마다 편차를 두고 매년 12/25·1/1 날짜 하루에는 건수 추가; 이력 6건).
  * **규모는 접속 방식에 따라 다릅니다.**

    | 접속 방식 | 성도 | 헌금 | 규격 |
    | :--- | :--- | :--- | :--- |
    | 데스크톱 앱 | 800명 | 20만 건 (주 750~2,000건, 하루 5,000건 추가) | `DEMO_SPEC_APP` |
    | 브라우저(휴대폰 포함) | 800명 | 약 6.3만 건 (최근 18개월 78주, 주 500~1,333건, 하루 3,333건 추가) | `DEMO_SPEC_BROWSER` |

  * **만드는 방식:** 시간은 대부분 IndexedDB 쓰기(행당 약 45µs, 색인 3개)이며 데이터 생성은 0.1초라 건수에 거의 비례합니다. 헌금은 **최근 달부터 한 달씩 만들어 한 달씩 저장**하고, 처음 3개월이 저장되면 `onReady`로 화면을 열어 바로 쓰게 하며(브라우저 규격 약 0.5초) 나머지 과거 달은 이어서 만듭니다. 진행은 `DemoBanner`에 `n/전체개월`로 표시하고(`setDemoCreating`), 메모리는 한 달치입니다. [시연 데이터 생성]을 누르면 레이어가 즉시 닫히고 안내 띠가 바로 뜹니다.
  * **표식과 규칙:** 시작에 `meta_restore_in_progress`(kind `demo`)를 남기고 끝에 지웁니다. 앱 규칙(같은 날·같은 성도·같은 종류는 한 건)을 지키려고 성도 헌금은 종류마다 서로 다른 성도에서 뽑고 모자라는 건수는 무명/방문자로 채웁니다.
  * **시연 중 판단:** 시연 성도·종류·헌금 id는 모두 `demo-`로 시작하며, **한 건이라도 있으면 시연 중**입니다(`hasDemoData`: 성도·종류는 kv 배열, 헌금은 `offeringTypeId`·`memberId` 색인의 접두어 범위 조회라 전체를 훑지 않음). 시연 중에는 최상단 메뉴 위에 안내 띠(`DemoBanner`)가 뜨고, 시연 생성과 전체 초기화는 비활성이며 [시연 데이터 제거]만 보입니다.
  * **생성·제거 제한:** 만드는 동안에는 [시연 데이터 제거]가 비활성이며 `removeDemoData`도 오류로 거부합니다. 성도·헌금 데이터가 하나라도 있으면 생성을 거절합니다(`hasAnyData`; 백업하지 않음). 제거(`removeDemoData`)는 시연 중 수정·추가분까지 모두 지우고 빈 상태(기본 헌금 종류)로 복구하며 이전 버전의 `meta_demo_restore` 키도 지웁니다.
  * **지우기 방식:** 헌금 저장은 `bulkPut`과 `bulkAdd`가 같고(6만 건 3.2초 vs 3.4초), 통째 삭제는 달별 범위 삭제와 `clear()`가 같습니다(6만 건 0.26초 vs 0.25초). 그래도 `wipeDonationsWrites`(`clear()`)로 전부 지우는 경로(`replaceAllData`·시연 생성)를 통일했고 `bulkAdd`는 채택하지 않았습니다.
  * **브라우저 첫 접속:** 데스크톱 앱이 아니라 브라우저로 처음 열고(휴대폰 포함) 데이터가 비어 있으면 브라우저 규격으로 자동 생성하고 진행 화면(`DemoPreparing`)을 보여 줍니다(`useAutoDemo`). 이 브라우저에서 한 번만, 사용자가 지운 뒤에는 다시 만들지 않습니다(`localStorage`의 `steward-auto-demo-done`; 만들다 끊긴 것은 지우고 처음부터).
  * **측정(Chromium, 개발 서버):** 40만 건일 때 생성 약 19초·최대 힙 107MB·연 보고서 약 11만 건 로딩 0.9초. 브라우저 규격 생성 약 5~8초(첫 접속 자동 생성은 페이지 로딩 포함 약 12초; 실제 휴대폰은 더 걸림), 첫 화면 사용까지 약 0.5초·전체 완성 약 7.5초, 제거 약 0.7초(원본이 없을 때).
* **큰 복원:** 3개 연도 × 월 1.2만 건(43.2만 건) 복원이 한 트랜잭션으로 약 8초에 끝남을 확인했습니다(fake-indexeddb). 실패하면 전부 취소됩니다.

## 11. 입력 화면 설계

* **저장 흐름:** `requestSave` → 검증(`buildDrafts`) → 큰 금액 확인 → 중복 확인(`findDuplicates`) → `saveBatch`. 전체가 `exclusive`로 감싸여 연타에 안전합니다.
* **복구하기:** `SaveBatch { createdIds, mergedBefore, lines }`를 메모리에 최대 10개 보관. `undoLast`는 생성분 삭제 + 합산 전 스냅샷 복원을 한 트랜잭션으로 하며 사유 “입력 직후 복구하기”를 기록합니다. Ctrl+Z는 입력 칸이 모두 비어 있을 때만 가로챕니다.
* **최근 입력:** `useHistoryItems`가 저장 묶음의 id로 **현재 값**을 찾아 줄을 만들어(수정·월 이동 반영) 못 찾으면 저장 당시 내용을 읽기 전용으로 보입니다. [수정]은 보고서와 같은 `useDonationEditor`(사유 필수)를 씁니다.
* **무명 번호:** 선택일의 `무명N` 최댓값 + 1(`nextAnonymousName`). 카운터를 저장하지 않으므로 삭제·복구하기·날짜 변경과 항상 맞습니다. 문자열만 구독해 번호가 바뀔 때만 다시 그립니다.
* **금액:** `parseAmount`(쉼표 제거 후 안전 정수·양수), `addQuickAmount`(15자리 초과 시 무시), `amountToKorean`(표시 전용).
* **단축키:** 전역 keydown에서 처리하되 열린 대화상자(`[role=dialog][data-state=open]`)가 있으면 무시합니다. 한글 조합 중 Enter(`isComposing`)는 무시하고, 금액 단추는 `tabIndex={-1}` + `onMouseDown preventDefault`로 포커스를 유지합니다. 진입 시에는 어느 칸에도 포커스를 두지 않습니다.
* **처음 사용 안내:** `isFirstRun = members.length === 0`이면 `FirstRunGuide`가 맨 위에 렌더되며, `App`이 넘기는 `onNavigate`(`useAppNav.setPage`)로 해당 메뉴로 이동합니다.
* **브라우저 안내:** `desktop()`이 없으면(데스크톱 앱이 아닌 브라우저·모바일) 입력 카드 위에 빨간 시연용 안내를 그립니다.
* **현금 계수:** 선택일 합계는 파생 값(`dailyTotals`)을 구독하는 별도 컴포넌트가 계산해 입력 칸 변경에는 다시 그리지 않습니다. 계수 금액은 컴포넌트 로컬 상태입니다.

## 12. 인쇄, 테마, 달력

* **인쇄:** `@page { size: A4 landscape; margin: 0 }`로 브라우저 머리글·바닥글이 들어갈 자리를 없애고, 실제 여백은 `main`의 `print:p-[12mm]`와 표의 `thead/tfoot` 간격 행(5mm, 쪽마다 반복)으로 줍니다. 표는 9.5pt·낮은 행 높이로 한 쪽에 약 34행. `print-color-adjust: exact`로 배경이 인쇄됩니다. `PrintHeader`가 한 줄 머리글(제목·요약·출력일시)을 그리며 출력일시는 `beforeprint`에서 갱신합니다. 실제 쪽 나눔과 프린터 여백은 인쇄해서 확인해야 합니다.
* **테마:** Tailwind 4가 색을 `var(--color-*)`로 컴파일하므로 `index.css`가 `:root[data-theme]`별로 변수만 덮어씁니다(컴포넌트 수정 없음). 화면 테마 변수는 `@media screen`에만 있어 인쇄에는 영향이 없고, 인쇄 색은 `data-print-theme`의 8개 변수로만 정해집니다. 마지막 테마는 `localStorage`에 기록해 `main.tsx`가 렌더 전에 먼저 적용하므로 색이 깜빡이지 않습니다.
* **달력:** 일요일 시작 6주(42칸) 고정 그리드, 일요일 빨간색. 입력 칸은 숫자만 받아 `YYYY-MM-DD`로 정리합니다. `pickOnly`는 읽기 전용으로 달력으로만 선택하게 합니다(헌금 입력 날짜). 달력은 어디서든 입력 칸 아래에 **겹쳐(absolute) 띄워 창 높이를 늘리지 않고 아래 내용을 덮습니다.** Radix `Dialog` 안에서는 내용 영역의 `overflow-y-auto`가 팝업을 잘라내므로, 달력을 쓰는 짧은 창(헌금 수정, 성도 등록·수정, 빠른 등록)은 `Modal`의 `overflowVisible`로 잘림을 풀어 줍니다(포털로 빼면 포커스 트랩·바깥 클릭 감지와 충돌하기 때문).
* **어두운 테마(`data-theme="DARK"`):** 같은 방식으로 `--color-gray-*`를 **뒤집은** 값, `--color-white`(= `bg-white` 표면색)를 어두운 색, 파랑·빨강·초록·황색 계열을 어두운 바탕에서 읽히는 값으로 덮어쓰고 `color-scheme: dark`로 입력 칸·스크롤바도 어둡게 합니다. `--color-white`가 `text-white`에도 쓰이므로 색 단추(`.btn-primary`, `.btn-danger`)와 `.text-white`는 글자를 흰색으로 고정하고 hover 색은 따로 지정합니다. 화면 전용(`@media screen`)이라 인쇄는 밝은 팔레트와 `data-print-theme`를 그대로 씁니다. 그래서 `PrintTheme`에는 `DARK`가 없습니다.
* **저장 성공 효과:** `useDonationInput.savedSeq`가 저장 성공마다 1씩 올라가고, `Notice`(`success`)와 `DailyTotalsBar`(`flashKey`)가 `key`가 바뀌어 `pop-in`·`flash-save` CSS 애니메이션을 다시 재생합니다. `prefers-reduced-motion`이면 애니메이션을 끕니다.
* **표 행 강조:** `.rpt-table tbody tr:not(.rpt-total-row):hover > td`와 `.row-hover:hover`(가상 목록)가 `--color-blue-50`을 칠합니다(화면 전용, 고정 열 셀도 같은 색).
* **글자 크기:** 설정이 루트 글자 크기(100%/112.5%/125%)를 바꾸며 Tailwind가 `rem` 기반이라 화면 전체가 함께 커집니다.
* **시간대(서울 고정):** "오늘"·"지금 시각"은 PC 시간대와 상관없이 서울 기준입니다. `dates.ts`의 `seoulNow()`가 시각을 서울 벽시계로 바꾼 `Date`를 돌려주고(`todayString`·`lastSunday`·`nowStamp`·`formatDateTime`·인쇄 출력일시·보고서 기본 연/월·시연 데이터가 사용), 데스크톱 앱은 `main.cjs`에서 `TZ=Asia/Seoul`도 지정합니다. 저장된 헌금 날짜는 `YYYY-MM-DD` 문자열이고 백업·이력의 시각은 UTC ISO로 저장되며, 화면에 보일 때만 서울 시각으로 바꿉니다. 새 코드에서 `new Date()`로 날짜를 만들 때는 `seoulNow()`를 쓰세요.
* **접근성:** 주 메뉴 `aria-current`, 보고서 탭 `role=tablist/tab` + `aria-selected`, 토글 `aria-pressed`, 성도 열 제목 `aria-sort`, 검색 `role=combobox/listbox`, 결과 알림 `aria-live`.

## 13. Electron 셸

* `requestSingleInstanceLock()`으로 중복 실행 차단. `contextIsolation: true`, `nodeIntegration: false`. CSP는 응답 헤더로 강제. 서비스 워커·PWA 없음. 업데이트는 자동으로 확인하지 않고 사용자가 누를 때만 확인합니다(아래).
* **영문 저장·백업 경로:** 데이터 폴더는 `%APPDATA%\StewardLedger`, 기본 백업 폴더는 그 안의 `backup`입니다(설치 폴더는 업데이트·재설치 때 설치 프로그램이 통째로 지우므로 쓰지 않음. 예전 기본 폴더 `문서\StewardLedgerBackup`의 파일은 옮기거나 지우지 않음). 이전 버전의 한글 데이터 폴더(`교회헌금회계`)가 있으면 앱이 데이터를 열기 전에 한 번 이름을 바꿔 옮기고(예전 한글 백업 폴더 `문서\교회헌금백업`은 옮기거나 지우지 않음), 옮기지 못하면(다른 프로그램이 사용 중 등) 데이터를 잃지 않도록 이전 폴더를 계속 씁니다. 설치 폴더 이름도 영문입니다: `productName`이 `StewardLedger`라 기본 설치 위치는 `%LOCALAPPDATA%\Programs\StewardLedger`, 설치 파일은 `StewardLedger Setup 1.0.0.exe`이며 데이터와는 별개입니다(바탕화면·시작 메뉴 바로가기 이름 `청지기 장부`와 창 제목은 표시용이라 한글 그대로). 이미 한글 폴더(`청지기장부`)에 설치된 PC에 새 설치 파일을 실행하면 설치 프로그램이 이전 설치 위치를 그대로 재사용할 수 있으므로, 영문 폴더로 옮기려면 기존 프로그램을 먼저 제거(데이터는 `deleteAppDataOnUninstall: false`로 보존)한 뒤 설치합니다. 테스트는 `src/services/dataPaths.test.ts`.
* **프로그램 업데이트(`electron-updater`):** 설정 화면의 [업데이트 확인]을 누를 때만 main이 `update:check`로 GitHub 릴리스(`build.publish`)의 `latest.yml`을 읽습니다(평소에는 네트워크를 쓰지 않음, 포장된 앱에서만). [내려받기]는 `update:download`로 `.blockmap`을 비교해 바뀐 블록만 받고(`update:progress`로 진행률), `autoInstallOnAppQuit`로 앱을 닫을 때 종료 백업이 끝난 뒤 설치합니다(강제 재시작 없음). 내려받은 파일은 `latest.yml`의 sha512로 확인합니다. 오류는 경로가 섞이지 않은 고정 문구로 바꿔 보냅니다. 화면용 라이브러리는 vite가 `dist`에 묶으므로 `devDependencies`에 두고, 설치 파일에는 `electron-updater`와 그 의존성만 들어갑니다.
  * **릴리스 절차:** `package.json`의 `version`을 올리고 `npm run dist` → `release/`의 `StewardLedger Setup x.y.z.exe`, 같은 이름의 `.blockmap`, `latest.yml` 세 파일을 GitHub 릴리스(태그 `vx.y.z`)에 올립니다(`GH_TOKEN`을 설정하면 `npx electron-builder --win nsis --publish always`로도 가능).
* **화면 멈춤 대응:** `render-process-gone`(비정상 종료)이면 창을 다시 불러오고(1분에 3번 넘으면 안내 후 중단), `unresponsive`이면 [기다리기 / 다시 불러오기]를 묻습니다. 데이터는 IndexedDB에 있어 다시 불러와도 이어서 쓸 수 있습니다. React 화면 오류는 `ErrorBoundary`가 화면 단위로 잡아 앱 전체가 하얗게 되지 않고 메뉴를 계속 쓸 수 있습니다(메뉴를 옮기면 새로 시작).
* **preload**(`electron/preload.cjs`)는 `contextBridge`로 최소 API만 노출합니다: 자동 백업 쓰기·정리, 백업 파일 검사·풀어 읽기(파일 또는 경로 문자열), 가장 최근 종료 전체 백업 찾기(`latestAutoBackup`, 전체 복원용), 저장 파일 열기/폴더 보기, 다운로드 완료 알림, 업데이트.
* **종료 시 자동 백업:** 데이터가 렌더러에 있으므로 종료 요청 시 main이 렌더러에 `backup:request`를 보냅니다. 렌더러는 줄 단위 백업 세션(`backupBegin`·`backupWrite`·`backupEnd`)으로 한 달치씩 main에 보내고, main이 gzip 파일로 씁니다(10장). main은 **끝날 때까지 기다린 뒤 종료**합니다(상한 5분).
  * 렌더러가 요청을 받으면 `ClosingOverlay`(전체 화면 안내, 0.4초 뒤에 표시, 5초 후 [백업 없이 종료] → `backup:skip`)를 띄웁니다.
  * 쓰기에 실패하면 main이 [그래도 종료 / 종료 취소]를 묻습니다(취소하면 `backup:cancelled`로 안내를 닫고 앱을 계속 씁니다).
  * 화면 프로세스가 죽거나 Windows `session-end`(종료·로그오프)이면 기다리지 않습니다. `close`는 이미 백업을 기다리는 중이면 중복 실행하지 않습니다.
* **보안 설정:** 자동 백업은 화면이 경로를 보내지 않고 main이 정한 기본 폴더(`%APPDATA%\StewardLedger\backup`)에만 씁니다. 폴더 변경 기능은 없습니다. 카메라·위치 같은 모든 권한 요청은 거부합니다. 빌드 때 Electron 퓨즈로 `runAsNode`, `NODE_OPTIONS`, `--inspect` 인자를 끄고 asar 무결성 검증과 asar에서만 불러오기를 켭니다(`electronFuses`).
* **파일 열기:** 저장 창에서 정한 PDF의 저장 경로만 `savedFiles`에 기록하고, `file:open`/`file:show`는 그 경로만 처리해 렌더러가 임의 파일을 실행하지 못하게 합니다.

## 14. 저장소 버전

`db.ts`는 버전 1(`kv`·`donations`)과 버전 2(`audits` 테이블 추가, §6.2의 이력 옮기기)를 선언합니다. 예전 localForage 형식에서 옮기는 코드는 없습니다. 저장 구조를 바꿀 때는 `version(n)`을 추가하고 `upgrade`로 옮기세요(Dexie는 기본키를 직접 바꾸지 못해 테이블을 지웠다가 다시 만들어야 합니다). 한 번 연 데이터는 이전 버전의 앱으로 다시 열 수 없습니다. 시작할 때 저장소를 열지 못하면 빈 화면 대신 한글 오류 안내를 보여 줍니다(`openStorage`, `StorageError`).

## 15. 성능 측정과 설계 근거

성도 1,000명, 매주 4,000건 × 260주(104만 건), 연 약 18만 건. 개발 화면 기준 측정이며 시험 데이터 생성은 `test-data/seed-large.mjs`(저장소에 포함되지 않음).

| 문제(변경 전) | 원인 | 조치 | 결과 |
| :--- | :--- | :--- | :--- |
| 저장 시 연도 전체를 다시 씀 | 연도 단위 키 | **월 단위 키** | 저장 45ms → 3ms (연 1.4만 건) |
| 복구하기 1.5초 | 모든 달을 읽음 | 저장한 달 먼저 | 0.06초 |
| 주·월 이동 0.9초 | 1,000행 전체 렌더 | 가상 스크롤 + 행 높이 측정 | 0.25초 |
| 연 단위 전체 입력 내역 4초 | 18만 건 정렬·행 생성 | 문자열 비교, 보이는 행만 계산 | 0.06초 |
| 메모리 70MB, 연도가 계속 쌓임(200MB+) | 연도 배열을 해제하지 않음 | 달 단위 + 메모리 건수 예산(7.2) | 입력 화면 35~40MB, 5개 연도 열어도 210~230MB |
| 104만 건 복원 실패 | 저널 값이 IndexedDB 한도 초과 | 연도 하나씩 복원·이전 | 연도 33MB 복원 0.3초 |
| 저장 233ms | 연도 배열 재구성 | 달 배열만 교체 | 83ms |

## 16. 테스트

`npm test` (Vitest, 38개 파일, 224건 — 2026-11-20 기준). 저장소는 `fake-indexeddb`, 화면 상태는 `jsdom` + `@testing-library/react`.

| 영역 | 파일 | 검증 |
| :--- | :--- | :--- |
| 순수 규칙 | `domain/*.test.ts` | 금액·검색·세대·정렬·월 캐시·월별 행렬 = 주별 합 |
| 저장소 | `storage/monthly.test.ts`, `donationsTable.test.ts`, `storageErrors.test.ts` | 행 단위 쓰기·롤백, 색인 중복 검사, 연도 백업·복원 왕복, 저장소 오류 안내 |
| 백업 | `backup/mergeRules.test.ts`, `testData.test.ts` | 병합 규칙·id 다시 연결, 시험 데이터 무결성 |
| 화면 상태 | `contexts/DonationContext.test.tsx` | 달 배열 교체·유지, 읽기 경합 재조회, `reloadAll` 무효화, 읽기 실패 재시도, 월·연도 이동 수정과 이력, 이동한 내역 복구하기, 연도 퇴출(건수 예산·사용 중 유지), 연도 목록 갱신 |
| 연타 방지 | `hooks/exclusive.test.ts` | 진행 중 호출 무시, 실패 후 해제 |
| 백업 | `backup/autoBackupService.test.ts`, `backup/backupCrypto.test.ts`, `backupVerify.test.ts`, `dataPaths.test.ts` | 주기 백업(변경 표시 처리·실패 복구), 스트리밍 줄 = 스냅샷, 달을 넘는 이동 시 재시도, 직접 백업 세션, 백업 파일 검증(변조·잘림), 암호화 왕복·틀린 암호·다른 PC·조각 변조/순서/잘림, 백업 폴더 허용 |
| 오류 복구 | `shared/ErrorBoundary.test.tsx`, `monthly.test.ts` | 화면 오류 안내와 다시 시도, 트랜잭션 전체 취소·같은 키 마지막 쓰기 우선 |

**Electron 스모크:** `npm run build` 후 `npm run smoke`가 임시 데이터 폴더로 앱을 띄워 시작·저장소·보안(Node 접근 불가, CSP, 권한 거부)·백업 IPC(쓰기·검증·허용 폴더)를 확인합니다. `SMOKE_EXE=release\win-unpacked\StewardLedger.exe`를 주면 포장된 앱(퓨즈 포함)을 시험합니다.

**자동으로 확인하지 못하는 것:** 실제 프린터 출력, 설치본(NSIS) 설치·제거 흐름. 이 부분은 직접 확인해야 합니다.

## 17. 알려진 한계

* 날짜 형식이 깨진 옛 데이터는 월별 이전에서 제외될 수 있다.
* 메모리에서 내려간 연도의 내역은 “최근 입력” 줄에서 저장 당시 내용(읽기 전용)으로 표시된다.
* 새로 저장한 내역을 복구하면 생성 기록이 없는데도 이력에 `DELETE(입력 직후 복구하기)`가 남는다.
* 복원은 설정을 포함하지 않는다. 오래된 백업을 복원하면 그 뒤에 추가된 금액 단추 등은 헌금 종류 화면에서 다시 추가해야 한다.
* 이름만 같고 연락처가 없는 성도는 다른 PC 백업 병합 때 새 성도로 추가된다(복원 창이 안내).
* **갑작스러운 정전·강제 종료:** IndexedDB 트랜잭션 덕분에 여러 키에 걸친 작업이 일부만 반영된 채 남지 않습니다. 다만 운영체제가 아직 디스크에 쓰지 않은 **마지막 몇 초의 저장은 사라질 수 있습니다**(IndexedDB의 일반적인 쓰기 보장 수준). 자동 백업은 앱을 정상 종료할 때만 만들어지므로 정전 직전까지의 변경은 백업에 없을 수 있습니다.
* **이전 설치본으로 복구하기 불가:** 데이터베이스 버전이 올라간 뒤에는, 한 번 실행한 데이터를 그 이전 설치본으로 열 수 없습니다. 복구해야 하면 먼저 백업 파일을 만들고, 이전 설치본에서 복원하세요.
* 매우 큰 데이터(수십만 건 이상)에서는 종료 시 백업이 오래 걸려 종료 안내가 길게 보입니다(8초 후 건너뛰기 가능, 상한 5분).
* 자동 백업 폴더를 OneDrive가 동기화하는 문서 폴더나 USB·네트워크 드라이브로 두면 쓰기가 느리거나 실패할 수 있습니다(실패하면 종료 전에 묻습니다). 데이터 폴더는 Windows 계정별이므로 다른 계정으로 로그인하면 비어 있습니다.
* Windows 10 이상 64비트만 지원합니다(Electron 45).
* 서명되지 않은 설치 파일은 Windows 스마트 앱 컨트롤에서 막힐 수 있다.

## 18. 빌드 · 실행 · 배포

| 명령 | 용도 |
| :--- | :--- |
| `npm run dev` | 개발 서버 (http://localhost:5173), 브라우저 모드 |
| `npm run dev:app` | 개발 서버 + Electron 창(PC앱 모드). 창을 닫으면 서버도 종료 |
| `npm run build` | 타입 검사 + 웹 빌드 |
| `npm test` | 전체 테스트 |
| `npm run testdata` | 시험 데이터 백업 파일 생성 |
| `npm run smoke` | Electron 스모크 시험(`npm run build` 후) |
| `npm run electron:dev` / `electron:start` | 데스크톱 앱 실행(개발 / 빌드 후) |
| `npm run dist` | Windows 설치 파일(`release/`, NSIS, 설치 경로 변경 가능, 삭제해도 데이터 보존) |

* **시연 페이지:** `main`에 올리면 `.github/workflows/pages.yml`이 빌드해 GitHub Pages에 배포합니다(저장소 Settings → Pages의 Source가 “GitHub Actions”여야 함).
* **새 버전 알림(웹만):** 빌드마다 `dist/version.json`(`{id}`)을 만들고 같은 값을 번들에 `__BUILD_ID__`로 넣습니다. 열려 있는 화면은 10분마다·탭으로 돌아올 때 `version.json`을 확인하고, 다르거나 나중에 불러오는 파일(엑셀 등)이 없어져 `vite:preloadError`가 나면 `NewVersionBanner`로 [새로고침]을 안내합니다(자동 새로고침은 입력 중 내용 유실 때문에 하지 않음). 이미 열려 있던 옛 화면은 새로고침해야 새 버전이 됩니다.
* **버전:** `package.json`의 `version`과 `contexts/types.ts`의 `APP_VERSION`을 함께 바꾸고, 백업 파일 형식을 바꿀 때만 `SCHEMA_VERSION`을 올립니다.
