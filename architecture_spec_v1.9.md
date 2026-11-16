# 청지기 장부 (Steward Ledger) — 오프라인 교회 헌금 회계 기록 시스템 - 아키텍처 명세서 (v2.14)

인터넷 연결이 불안정하거나 완전히 차단된 환경(예: 지하 예배실, 외부 선교지 등)에서도 성도별 헌금 내역을 유실 없이 안전하게 기록하고, 월/분기/년 단위 및 세대별 재정 통계를 결산하여 보고할 수 있는 **PC 중심의 오프라인 우선(Offline-First) 데스크톱 웹 애플리케이션**입니다.

---

## 1. 시스템 아키텍처 및 핵심 철학

### 개발 핵심 제약 및 설계 원칙
1. **오프라인 우선 (Offline-First):** 모든 데이터는 외부 API나 백엔드 서버 없이 브라우저 내부 IndexedDB 스토리지에 즉시 영구 저장됩니다.
2. **초정밀 아토믹 렌더링 (Fine-grained Re-rendering):** 아토믹 디자인 패턴과 `use-context-selector`를 결합하여 값이 변경된 최소 단위의 컴포넌트만 독립적으로 리렌더링됩니다.
3. **로직과 뷰의 완전 격리:** 컴포넌트 파일(`.tsx`) 내부에는 조건식, 상태 제어 등 비즈니스 로직이 단 한 줄도 포함되지 않으며 오직 '값'과 완성된 '이벤트 핸들러'의 바인딩 명세서 역할만 수행합니다.
4. **실용적 CSP 및 제한적 인라인 스타일 허용 (v1.9 개정):**
   * 외부 스크립트 실행 차단(`script-src 'self'`)과 사용자 입력값에 대한 XSS 및 엑셀 수식 인젝션 방어 규칙은 엄격히 유지합니다.
   * 단, `@tanstack/react-virtual`의 동적 좌표 계산(`transform: translateY(...)`)과 인쇄 레이아웃 정밀 제어를 위해 **컴포넌트 내 제한적 인라인 스타일(`style={{...}}`) 사용을 허용**합니다.
5. **라이선스 무결성:** 상업적 이용 및 개작이 완벽히 허용되는 **MIT 라이선스 중심**의 오픈소스로 스택을 구성하여 저작권 리스크를 원천 차단합니다.
6. **대용량 및 회계 정합성 보장 (v1.9 강화):** 연도별 샤딩(Sharding) 및 연도 경계 이관 트랜잭션, 납부 당시 세대 스냅샷(`familyGroupIdSnapshot`), `BroadcastChannel` 다중 탭 동기화, 수정/삭제 감사 로그(`AuditLog`)를 내장합니다.

---

## 2. 확정 기술 스택 (Tech Stack)

| 분류 | 기술 및 라이브러리 명칭 | 라이선스 | 채택 이유 |
| :--- | :--- | :--- | :--- |
| **기반 스택** | `React` + `TypeScript` + `Vite` | MIT | 프런트엔드 정적 타입 안정성 및 고속 빌드 |
| **데이터베이스** | `localForage` (연도별 샤딩) | MIT | IndexedDB 기반 대용량 저장 및 연도별 키 분할을 통한 메모리 병목 차단 |
| **상태 관리** | `use-context-selector` | MIT | Context API의 전역 리렌더링을 방지하고 구독 컴포넌트만 정밀 리렌더링 |
| **UI 및 스타일링** | `Tailwind CSS` + `Radix UI (Primitives)` | MIT | Headless 접근성 컴포넌트와 순수 유틸리티 클래스 조합 (가상 스크롤/인쇄용 인라인 스타일 제한 허용) |
| **대용량 가상화** | `@tanstack/react-virtual` | MIT | 연간 수만 건의 상세 내역 조회 시 화면 노출 영역만 렌더링하여 60fps 스크롤 유지 |
| **데이터 가공** | `lodash-es` + `date-fns` | MIT | 불변성 깊은 복사(`cloneDeep`), 고속 그룹화(`groupBy`), 정밀 날짜 연산 |
| **달력 선택기 (v2.1)** | 자체 `DatePicker` (`date-fns` 기반, 신규 의존성 없음) | MIT | 브라우저 기본 `<input type="date">` 팝업은 CSS로 일요일을 빨갛게 칠할 수 없어, 일요일 빨간색 표시·연/월 선택·직접 입력을 지원하는 자체 컴포넌트로 대체 |
| **CSV 파싱** | `papaparse` | MIT | 명단 가져오기용 CSV 파싱 (CP949는 `TextDecoder('euc-kr')`로 사전 디코딩) |
| **엑셀 변환** | `exceljs` | MIT | 브라우저 단 버퍼 연산 기반 동적 수식(`SUMIFS`) + 캐시 결과값(`result`) 포함 `.xlsx` 바이너리 빌드 |
| **데스크톱 래핑** | `electron` + `electron-builder` (Windows NSIS 전용) | MIT | 설치형 오프라인 앱 배포, userData 영역 IndexedDB 보존, 단일 인스턴스 잠금 |
| **다중 창 동기화** | `BroadcastChannel` (표준) | 표준 | 한 앱 내 다중 창 간 데이터 덮어쓰기 방지 |

> **v2.0 결정 사항 요약:** ① 배포는 Electron 래핑(PWA 미사용) ② 앱 잠금·백업 암호화는 v1 제외 ③ 수정/삭제는 보고서 상세 리스트 행에서 수행 ④ 봉투는 종류별 개별 `Donation` 레코드 ⑤ 세대주 `Member.id` = `familyGroupId`.
>
> **v2.1 결정 사항 요약:** ① 주별 보고서는 종합 보고서의 기간 선택 항목(`PeriodType = 'WEEK'`)이며 일요일~토요일 한 주를 집계하는 읽기 전용 파생 뷰(저장 데이터·스키마 변경 없음), 엑셀·메일·인쇄 지원 ② 무명 번호(`무명N`)는 카운터를 저장하지 않고 선택일 장부에서 계산 ③ 날짜 입력은 자체 `DatePicker`로 통일 ④ 직분은 고정 선택 목록(기존 값 보존) ⑤ 건축·선교헌금 기본값 변경은 신규 설치 시드 + 기존 데이터 1회 조건부 보정 ⑥ OS의 한/영 상태는 웹에서 제어할 수 없으므로 검색창은 영문 자판 입력을 한글로 변환(`domain/hangul.ts`). `schemaVersion`(2)과 백업 형식은 변하지 않습니다.
>
> **v2.14 결정 사항 요약:** ① 합계 행 `sticky bottom-0`(셀 단위, 왼쪽 고정 열은 `z-20`) ② 인쇄 성도명 열 `.rpt-name-col`/`.rpt-name` 9.5rem·`nowrap`, 엑셀 `fitNameColumn` ③ 헌금 종류 `migrateOfferingTypesV24`(이름 기준 누락 시 추가, 플래그 `meta_migration_offering_v24`) ④ `OfferingActions.countUsage/remove`(트랜잭션 안에서 모든 연도 샤드의 사용 건수를 확인하고 0일 때만 삭제) + 삭제 UI(안내·확인 `Modal`) ⑤ 성도 목록 번호 열·생년월일 열 제거.
>
> **v2.13 결정 사항 요약:** ① `buildWeeklyMatrix`에 동명이인 보조 키(`tieBreak`, `memberOrderKey`) ② `REPORT_SCROLL` 공용 스크롤 클래스 ③ 전체 입력 내역은 머리글을 스크롤 영역 안(sticky)에 두고 가상 스크롤 `scrollMargin`으로 보정 ④ `useIsPrinting`(beforeprint/afterprint) — 인쇄 중에는 가상 스크롤 대신 전체 행 렌더 ⑤ `.row-sep` 10행 구분선·`.rpt-num`.
>
> **v2.12 결정 사항 요약:** ① `useReportFilters` 기본 주 날짜를 `lastSunday()`로 복귀(`goLastSunday`), 주별 `DatePicker`는 `pickOnly` ② `ReportsPage`가 `reportKey`(기간·연도·값·주 시작일)가 바뀔 때 탭을 `SUMMARY`로 되돌림 ③ `.btn-accent` ④ 테스트 데이터 생성기 `scripts/generate-test-data.mjs`(백업 봉투 형식, 앱 코드 변경 없음)와 이를 검증하는 `testData.test.ts`.
>
> **v2.11 결정 사항 요약:** 전체 입력 내역 탭(`ListTab`, `useDonationListReport`, 순수 함수 `domain/donationList`: `sortForList`·`filterByDonor`) — 기존 `useDonationEditor`/`DonationEditModal` 재사용, 가상 스크롤.
>
> **v2.10 결정 사항 요약:** ① 한글 자동 변환 제거: `domain/hangul.ts`·`toKoreanInput`·`hangulAutoConvert` 설정·설정 체크 UI·관련 테스트 삭제(저장된 설정에 남은 `hangulAutoConvert` 키는 무시됨) ② `ThemePicker`를 `grid-flow-col auto-cols-fr`로 한 줄 배치 ③ `.btn-quick`(blue 계열 변수 사용, 테마별 `--color-blue-100` 추가) ④ 동명이인 표기는 `domain/memberName`(`duplicateNames`, `nameDisambiguator`) + `hooks/useNameTag` + `NameWithTag` ⑤ 인쇄: `print:-mt-4`로 제목-표 간격 축소.
>
> **v2.9 결정 사항 요약:** ① 테마는 Tailwind 팔레트 CSS 변수(`--color-gray/blue/slate-*`, `--color-white`)를 `@media screen { :root[data-theme] }`에서 덮어쓰는 방식 — 컴포넌트 클래스 변경 없음, 인쇄는 테마와 분리 ② `AppSettings.theme/printTheme`, `services/theme.ts`(`applyTheme`, `applyStoredTheme`, 옵션 목록) ③ 인쇄 색은 `:root[data-print-theme]`의 `--pt-*` 변수를 `.rpt-*` 클래스가 사용 ④ `DatePicker.pickOnly`(읽기 전용+달력 열기) ⑤ 입력 화면 검색 칸 폭 `minmax(0,26rem)`.
>
> **v2.8 결정 사항 요약:** ① `PrintFooter` 삭제 → `PrintHeader`(제목 + 요약 `PrintStat[]` + `출력일시`, `beforeprint`에서 `flushSync`로 시각 갱신) ② `dates.formatPrintStamp` ③ 인쇄 여백은 `@page margin:0` 유지, `main`은 `px 8mm / py 5mm`, 2쪽 이후 여백은 표의 `thead/tfoot`에 반복되는 `SpacerRow`(5mm)로 확보 ④ `.rpt-table` 글자 9.5pt·셀 패딩 1.5~2px, `html/body/#root{height:auto}`로 화면 높이 제한 해제.
>
> **v2.7 결정 사항 요약:** ① 인쇄: `@page { size: A4 landscape; margin: 0 }`(브라우저 머리글·바닥글 제거) + `main`의 `print:p-[12mm]`, 표는 `.rpt-table` 인쇄 전용 규칙(회색 머리글·굵은 성도명/합계·진한 테두리), `print-color-adjust: exact` ② Electron: `session.will-download` 완료 시 렌더러에 `download:done`, `file:open`/`file:show` IPC는 앱이 저장한 `.xlsx` 경로 화이트리스트(`savedFiles`)만 허용 ③ `useReportExport`는 `say()`로 문구를 바꿀 때마다 저장 파일 정보를 지워 `Notice.actions`로 단추를 노출 ④ 이력 필터는 순수 함수 `domain/auditFilter`(`auditLogsForPeriod`), 모든 연도 이력 장부를 불러와 날짜로 거름 ⑤ `useReportFilters` 기본값 = WEEK + 오늘.
>
> **v2.6 결정 사항 요약:** ① `PAGES` 순서 변경(입력→보고서→성도→종류→설정→설명서), `HELP_SECTIONS` 순서도 동일 ② `SortMark`(↕/▲/▼) ③ `undoLast`가 모든 연도 샤드에서 대상 내역을 찾아 되돌림 ④ `ensureYear/ensureAuditYear`는 이미 메모리에 값이 있으면 덮어쓰지 않음 ⑤ 설정 `dirty`를 정규화 값으로 비교 ⑥ 성도 비활성화는 확인창 전에 `canDeactivate` 사전 검사.
>
> **v2.5 결정 사항 요약:** ① 저장 메시지(`Notice`)를 입력 폼 위쪽 `min-h` 영역에 배치(레이아웃 이동 방지) ② 전역 단축키에 Ctrl+Enter(`requestSave`) 추가, 필드별 Enter 처리는 Ctrl/Meta 조합을 무시, 열린 Radix 대화상자(`[role=dialog][data-state=open]`)가 있으면 전역 단축키 전체 차단 ③ `useReports.usePersonalReport`에 `onSearchKeyDown/highlight` ④ 설정 화면 섹션 분리 + `dirty` 계산(`useSettingsPage`) ⑤ `calendar.weekdayLabelOf` + `useDatePicker.weekday` ⑥ `hooks/useHistoryItems`(현재 저장소 기준 이력, `useAllShards` 셀렉터) + `HistoryPanel`의 [수정] → `useDonationEditor`/`DonationEditModal` 재사용 ⑦ 성도 정렬은 순수 함수 `domain/memberSort.memberComparator`, 비활성화 확인은 `Modal`(상태는 `useMembersPage`) ⑧ 접근성 속성.
>
> **v2.4 결정 사항 요약:** ① 십일조 금액 단추 보정은 `migrateOfferingTypesV23`(공통 합집합 헬퍼 `addRequiredQuickAmounts` 재사용, 플래그 `meta_migration_offering_v23`) ② 금액 단추 누적은 순수 함수 `domain/amount.addQuickAmount`(15자리 초과 시 무시)를 `onQuickAmount`가 호출, `onClearAmount`로 칸 비우기.

> **v2.3 결정 사항 요약:** ① 저장 메시지에 `undoable` 플래그를 두고 `Notice`의 `action` 단추로 `undoLast`를 호출(UI는 표시만) ② 날짜 이동은 `useDonationInput`의 `prevWeek/nextWeek/goLastSunday`(`calendar.shiftWeek` 재사용) ③ 금액 한글 표기는 순수 함수 `domain/amount.amountToKorean`(단위 테스트 대상) + 표시 전용 `KoreanAmount` ④ 주별 표는 CSS `sticky`(+ `print:` 변형으로 인쇄 시 해제)와 `@media print { thead { display: table-header-group } }` ⑤ 현금 계수 칸은 `id`로 전역 `F4`/`Enter` 포커스 이동(`DailyTotalsBar`와 입력 훅 사이 결합을 DOM id로 한정) ⑥ `AppSettings.fontScale: 'NORMAL'|'LARGE'|'XLARGE'` → `SettingsProvider` 효과에서 `documentElement.style.fontSize` 적용(저장 포맷 변경 없음, 누락 시 기본값 병합) ⑦ 엑셀 두 빌더(`buildWorkbook`, `buildWeeklyWorkbook`)에서 결재 블록 삭제.

> **v2.2 결정 사항 요약:** ① 큰 금액 확인 기준 기본값 `10_000_000` (기존 설치본의 이전 기본값 `100_000_000`만 1회 보정) ② 안내 문구는 `shared/InfoTip` 툴팁 ③ 건축·선교헌금 금액 단추는 합집합 1회 보정 ④ 한글 자동 변환을 한글 텍스트 입력 칸 전체로 확대하고 설정(`hangulAutoConvert`)으로 끌 수 있게 함 ⑤ `사용 설명서` 페이지 추가(정적 콘텐츠 `helpContent.ts`) ⑥ 인쇄용 결재란(`PrintSignature`) 제거 → 출력일만 표시하는 `PrintFooter`. 모든 1회 보정은 `meta_migration_*` 플래그 키로 중복 실행을 막으며 `BackupEnvelope`·`schemaVersion`은 변하지 않습니다.

---

## 3. 프로젝트 디렉토리 구조 (Directory Structure)

```text
src/
├── contexts/                    # [Data Layer] 도메인별 분리 및 아토믹 상태 관리
│   ├── MemberContext.tsx              - 성도 마스터 데이터 및 세대 그룹 관리 (즉시 등록 지원)
│   ├── OfferingTypeContext.tsx        - 헌금 종류 및 UI/금액 단추 설정 관리
│   ├── DonationContext.tsx            - 연도별 샤딩·연도 경계 이관·세대 스냅샷·감사 로그 관리
│   ├── SettingsContext.tsx            - 수신 메일 주소 및 환경 설정 관리
│   └── types.ts                       - 핵심 데이터 모델 및 백업/감사 인터페이스 정의
│
├── services/                    # [Infrastructure Layer] 순수 비즈니스·인프라 유틸리티
│   ├── domain/                        - 순수 도메인 규칙(금액 검증, 초성 검색, 복수 헌금 합산, 세대 규칙, 세대 집계 키) — 단위 테스트 대상
│   │   ├── calendar.ts                  - (v2.1) 달력 그리드(일요일 시작·6주 고정), 월 이동, 날짜 입력 정리, 주 범위(일~토)
│   │   ├── weekly.ts                    - (v2.1) 주별 보고서 교차표(헌금 종류 × 성도명) 집계
│   │   ├── memberName.ts                - (v2.10) 동명이인 판정(`duplicateNames`)·구분 표기(`nameDisambiguator`: 연락처 뒷4자리 → 직분), 단위 테스트 대상
│   │   ├── anonymous.ts                 - (v2.1) 무명/방문자 자동 표기명(`무명N`) 산출
│   │   ├── positions.ts                 - (v2.1) 직분 선택 목록과 기존 값 보존 규칙
│   │   ├── offeringDefaults.ts          - (v2.1) 기본 헌금 종류 시드와 v2.1 1회 보정 마이그레이션
│   │   └── migrations.ts                - (v2.2) 건축·선교 금액 단추 합집합 보정, 큰 금액 기준 기본값 보정 (순수 함수, 단위 테스트 대상)
│   ├── storage/
│   │   ├── storageService.ts          - 연도별 샤딩(donations_YYYY) 및 연도 경계 이관 트랜잭션 엔진
│   │   └── tabSyncChannel.ts          - BroadcastChannel 기반 다중 창 상태 동기화 브릿지
├── (electron/)                  # [Desktop Shell] main.ts(단일 인스턴스 잠금, CSP 헤더, 창 관리), preload.ts
│   ├── excel/
│   │   ├── excelService.ts            - exceljs 기반 3단 시트 결산서 조립 엔진 (SUMIFS + 캐시값 + 인젝션 방어)
│   │   ├── downloadBridge.ts          - OS 금지 특수문자 치환 및 UTF-8 파일 다운로드 핸들러
│   │   └── mailtoProtocol.ts          - 데스크톱 기본 메일 앱 연동 안전 브릿지
│   ├── import/
│   │   └── memberImportService.ts     - CSV(UTF-8/CP949 자동감지, papaparse)·xlsx(exceljs) 명단 파싱, 검증, 중복 판정, 일괄 트랜잭션
│   └── backup/
│       ├── autoBackupService.ts       - 종료 시 자동 백업 직렬화 요청, 보관 개수(10) 정리 로직 정의
│       ├── backupService.ts           - 전역 데이터 마샬링 및 복원 직전 긴급 자동 백업기
│       └── validation.ts              - SHA-256 체크섬 검증 및 하위 스키마 마이그레이션 엔진
│
├── hooks/                       # [Logic Layer] 화면 제어 및 액션 핸들러 훅
│
└── components/                  # [Presentation Layer] 로직이 배제된 순수 뷰 컴포넌트
    ├── shared/
    │   ├── BackupReminderBanner.tsx   - 백업 권고 배너 UI
    │   ├── DatePicker.tsx             - (v2.1) 일요일 빨간색 달력 선택기 (상태·이벤트는 hooks/useDatePicker.ts)
    │   └── InfoTip.tsx                - (v2.2) ⓘ 아이콘 호버/포커스 툴팁
    └── pages/
        ├── donation-input/            # 1. 헌금 입력 (Enter/F2 핫키, 복수헌금 합산/추가 모달, 빠른 성도 등록 모달)
        ├── members/                   # 2. 성도 관리 (세대주 연결, Soft Delete 처리)
        ├── offerings/                 # 3. 헌금 종류 (노출 영역 및 단축 금액 단추 커스텀)
        ├── reports/                   # 4. 보고서 (종합(기간: 연/분기/월/주(v2.1))·개인/세대·감사로그 탭, 현재/납부당시 세대 기준 토글, 가상스크롤, Print CSS — v2.2: 결재란 없음, 출력일만 `PrintFooter`)
        ├── settings/                  # 5. 설정 정보 (기본 메일, 큰 금액 기준, 한글 자동 변환, 백업 안내 툴팁, 버전 호환 JSON 백업/복원)
        └── help/                      # 6. 사용 설명서 (v2.2: HelpPage + helpContent.ts 정적 콘텐츠, hooks/useHelpPage.ts 목차 이동)
```

---

## 4. 핵심 데이터 모델 명세 (`src/contexts/types.ts`)

```typescript
// 1. 성도 마스터 데이터 (Member)
export interface Member {
  id: string;                     // UUID v4
  name: string;                   // 성명
  position: string;               // 직분. v2.1부터 등록 UI는 목사/전도사/집사/권사/성도 선택 목록 (기존 데이터·가져오기의 다른 값(예: 집사)도 그대로 저장·표시)
  birthDate?: string;             // 생년월일 (YYYY-MM-DD) - 동명이인 식별용
  phoneLast4?: string;            // 연락처 뒷 4자리 - 동명이인 식별용
  familyGroupId?: string;         // 세대(가족/부부) 그룹 ID = 세대주의 Member.id (세대주 변경 시에도 그룹 ID 유지, isFamilyHead만 이전)
  isFamilyHead: boolean;          // 세대주 여부
  isActive: boolean;              // 활성 여부 (false 시 Soft Delete 처리되어 과거 통계 보존)
  createdAt: string;              // 생성 일시 (ISO 8601)
  updatedAt: string;              // 수정 일시 (ISO 8601)
}

// 2. 헌금 종류 설정 (OfferingType)
export interface OfferingType {
  id: string;                     // UUID v4
  name: string;                   // 헌금 명칭 (예: 십일조, 감사헌금, 주일헌금)
  displayArea: 'PRIMARY' | 'DROPDOWN'; // 입력 화면 노출 영역 구분
  quickAmounts: number[];         // 자주 쓰는 금액 단추 배열 (예: [10000, 50000, 100000])
  sortOrder: number;              // 노출 정렬 순서
  isActive: boolean;              // 활성 여부 (false 시 신규 입력 제외, 과거 통계 유지)
}

// 3. 헌금 내역 트랜잭션 (Donation - 연도별 샤딩 저장: donations_{YYYY})
export interface Donation {
  id: string;                     // UUID v4
  date: string;                   // 헌금 기준일 (YYYY-MM-DD) - 샤딩 키 산출 기준
  memberId: string | null;        // 성도 ID (무명/미등록 방문자일 경우 null)
  donorDisplayName: string;       // 표기명 (예: '김철수', '무명1', '방문자-홍길동'). v2.1: 무명은 날짜별 자동 번호 `무명N`
  familyGroupIdSnapshot?: string | null; // [v1.9] 입력 시점의 세대 그룹 ID 스냅샷 (연말정산 이력 보존)
  offeringTypeId: string;         // 헌금 종류 ID
  amount: number;                 // 헌금액 (원 단위 정수)
  memo?: string;                  // 비고/메모
  createdAt: string;              // 입력 일시 (ISO 8601)
}

// 4. 수정/삭제 감사 로그 (AuditLog - 연도별 샤딩 저장: audit_logs_{YYYY})
export interface AuditLog {
  id: string;                     // UUID v4
  targetId: string;               // 대상 Donation ID
  action: 'UPDATE' | 'DELETE';    // 변경 유형
  beforeSnapshot: Donation;       // 변경 전 데이터 원본
  afterSnapshot: Donation | null; // 변경 후 데이터 (삭제 시 null)
  reason: string;                 // 수정/삭제 사유 (필수, 공백 불가. 예: '동일 내역 복수 헌금 합산', '연도 경계 날짜 정정')
  timestamp: string;              // 작업 일시 (ISO 8601)
}

// 5. 버전 호환 JSON 백업 컨테이너 (BackupEnvelope)
export interface BackupEnvelope {
  appVersion: string;             // 앱 버전 (예: "1.9.0")
  schemaVersion: number;          // 스키마 구조 버전 (현재: 2)
  exportedAt: string;             // 백업 생성 일시 (ISO 8601)
  checksum: string;               // payload 무결성 검증용 SHA-256 해시
  payload: {
    members: Member[];
    offeringTypes: OfferingType[];
    donationsByYear: Record<string, Donation[]>;
    auditLogsByYear: Record<string, AuditLog[]>;
  };
}
```

---

## 5. 핵심 엔지니어링 스펙 및 엣지 케이스 방어 (v1.9)

### 1) 연말정산 세대 스냅샷 및 이중 집계 기준 (`DonationContext.tsx`, `excelService.ts`)
* **입력 시 스냅샷 박제:** 헌금 저장 시점의 `member.familyGroupId`를 `donation.familyGroupIdSnapshot`에 함께 저장하여, 연도 중 결혼·분가·세대주 변경이 일어나도 과거 귀속 세대 이력을 보존합니다.
* **이중 집계 모드 지원:** 보고서 화면 및 엑셀 `Sheet 2 (세대별_기부금집계)` 생성 시 **[현재 세대 기준]**(최신 `Member.familyGroupId` 기준)과 **[납부 당시 세대 기준]**(`familyGroupIdSnapshot` 기준) 중 선택하여 조회·출력할 수 있습니다.

### 2) 연도 경계 데이터 및 샤드 간 이관 트랜잭션 (`storageService.ts`)
* **기준일 기반 샤딩:** 신규 입력 시 브라우저 현재 연도가 아닌 `donation.date`에서 추출한 `YYYY` 키(`donations_{YYYY}`)에 저장하여 1월 초 전년도 12월 헌금 소급 입력을 정확히 처리합니다.
* **연도 변경 수정(`UPDATE`) 원자적 이관:** 기존 내역 수정 시 `beforeSnapshot.date`의 연도(`oldYear`)와 `afterSnapshot.date`의 연도(`newYear`)가 달라진 경우 아래 절차를 수행합니다.
  1. `donations_{oldYear}` 샤드에서 기존 레코드 제거
  2. `donations_{newYear}` 샤드에 수정된 레코드 삽입
  3. `audit_logs_{newYear}`에 연도 이관 이력 기록

### 3) `exceljs` 수식 호환성 및 수식 인젝션 방어 (`excelService.ts`)
* **동적 수식 + 캐시 결과값(`result`) 동시 바인딩:** 한컴오피스(한셀) 및 구버전 엑셀 뷰어에서 수식이 `0`으로 표시되는 현상을 막기 위해 `SUMIFS` 수식 삽입 시 JavaScript로 사전 계산한 실제 합계 금액(`result`)을 함께 주입합니다.
  ```typescript
  cell.value = {
    formula: `SUMIFS(전체헌금상세내역!$E$2:$E$${lastRow}, ...)`,
    result: calculatedSum // 한셀 및 구버전 뷰어 호환용 캐시 값
  };
  ```
* **엑셀 수식 인젝션(Formula Injection) 방어:** `donorDisplayName`, `memo` 등 텍스트 셀 기입 시 문자열이 `=`, `+`, `-`, `@`, `\t`, `\r`로 시작하면 앞단에 작은따옴표(`'`)를 자동 부착하여 악성 수식 실행 및 `#NAME?` 오류를 원천 차단합니다.
* **3단 시트 구성:**
  * **Sheet 1 (`종합결산요약`):** 헌금 종류 × 월별 매트릭스 (`SUMIFS` + `result` 캐싱, 가로 A4 1페이지 맞춤).
  * **Sheet 2 (`세대별_기부금집계`):** 선택된 세대 집계 기준(현재 세대 / 납부 당시 세대)에 따른 가족 합산 영수증 기초 시트 (`memberId === null` 무명 헌금 자동 제외).
  * **Sheet 3 (`전체헌금상세내역`):** 모든 트랜잭션 원본과 귀속월(`YYYY-MM`) 매칭 키, 틀 고정 및 한글 바이트 가중치 기반 자동 열 너비 조정 적용.

### 4) 동일 내역 복수 헌금 처리 & 빠른 성도 등록 브릿지
* **복수 헌금 중복 경고 모달 3종 액션:** `[동일 날짜 + 동일 성도 ID + 동일 헌금 종류 ID]` 일치 시(무명 제외) 아래 3가지 선택지를 제공합니다.
  1. **[기존 내역에 금액 합산]:** 기존 트랜잭션의 `amount`에 새 금액을 더하고 메모를 병기하여 업데이트합니다. (감사 로그 자동 기록)
  2. **[별도 건으로 추가 등록]:** 봉투가 별개임을 인정하고 독립된 새 트랜잭션으로 추가 저장합니다.
  3. **[취소 (Esc)]:** 입력을 취소하고 이전 인풋 창으로 포커스를 복귀합니다.
* **동명이인 및 미등록 성도 빠른 등록 브릿지:** 성도 검색 드롭다운 최하단의 `[+ 새 성도 즉시 등록]` 버튼(또는 단축키)을 통해 미니 모달에서 이름·직분·생년월일·연락처 뒷4자리·세대 연결을 즉시 입력하면, 방금 등록된 성도가 자동 선택된 상태로 헌금 금액 입력 칸으로 포커스가 이동합니다.

### 5) 한글 및 특수문자 파일명 다운로드 보호 & 키보드 핫키
* **파일명 보호 (`downloadBridge.ts`):** OS 금지 특수문자(`[\\/:*?"<>|]`)를 `_`로 치환 후 UTF-8 Blob 다운로드를 트리거합니다.
* **한글 조합 중복 이벤트 차단:** `e.nativeEvent.isComposing`을 검사하여 한글 입력 직후 `Enter` 타건 시 포커스가 두 칸 건너뛰거나 글자가 중복 입력되는 브라우저 버그를 차단합니다.
* **무명 모드 즉시 전환 (`F2`) 및 단축 금액 버튼 포커스 보호:** `F2` 키로 무명/방문자 모드를 즉시 전환하며, 단축 금액 버튼에는 `tabIndex={-1}`과 `onMouseDown={(e) => e.preventDefault()}`를 적용합니다.
* **Electron 셸 정책 (v2.0 대체):** 서비스 워커/PWA는 사용하지 않습니다. `requestSingleInstanceLock()`으로 중복 실행을 차단하고, `contextIsolation: true`·`nodeIntegration: false`를 적용하며, CSP(`script-src 'self'`)는 로컬 파일/커스텀 프로토콜 응답 헤더로 강제합니다. 자동 업데이트는 하지 않으며 설치 파일 교체 시 userData는 보존됩니다.

### 6) v2.0 추가 기능 설계 (금액 검증·이력 패널·합계 대조·자동 백업·명단 가져오기)
* **금액 검증:** 파싱은 문자열에서 쉼표 제거 후 `Number.isSafeInteger && > 0`으로 판정(훅 레이어). 확인창 임계값 기본 `10_000_000`(v2.2, 이전 `100_000_000`), `SettingsContext`에 `largeAmountThreshold`로 보관.
* **입력 이력/되돌리기:** 메모리 전용 스택 `SaveBatch { batchId, createdIds: string[], mergedBefore?: { id, snapshot: Donation }[] }`(최대 10개, 영속화 없음). 되돌리기는 `createdIds` 삭제 + `mergedBefore` 스냅샷 복원을 단일 트랜잭션으로 수행하며 `AuditLog.reason = '입력 직후 되돌리기'`로 기록. `Ctrl+Z`는 입력 칸이 모두 비어 있을 때만 가로챔.
* **선택일 합계 대조:** `DonationContext`의 선택일 샤드에서 파생 셀렉터(`dailyTotals: { total, count, byType }`)를 구독하는 원자 컴포넌트로 구성하여 입력 칸 변경에는 리렌더되지 않게 함. 계수 금액은 컴포넌트 로컬 상태.
* **자동 백업:** 데이터는 렌더러 IndexedDB에 있으므로, 종료 요청(`before-quit`/창 `close`) 시 main이 렌더러에 `backup:request` IPC를 보내 `BackupEnvelope` 문자열을 받고 main이 `fs`로 지정 폴더에 기록한다(최대 대기 5초, 초과 시 건너뛰고 경고 플래그 저장). preload는 `selectBackupDir`, `writeAutoBackup`, `pruneBackups` 등 최소 API만 `contextBridge`로 노출한다. 변경 감지는 `DonationContext`/`MemberContext`의 `dirtySinceBackup` 플래그.
* **명단 가져오기:** 파싱→정규화→검증→미리보기 행 모델(`{ rowNo, status: 'OK'|'WARN'|'ERROR'|'DUPLICATE', member, messages }`)→사용자 확정→단일 트랜잭션 저장 순으로 분리. 세대주 행을 선처리해 `id`를 확정한 뒤 세대원의 `familyGroupId`를 채운다. 모든 값은 문자열로만 취급한다.

### 7) 헌금 저장·수정·삭제 규칙 (v2.0 신규)
* **봉투 저장:** 금액이 입력된 종류마다 `Donation` 1건씩 생성(묶음 ID 없음). 복수 헌금 감지는 레코드별 수행.
* **수정/삭제:** 보고서 상세 리스트 행 액션으로만 수행하며 모두 `AuditLog`에 기록. 연도가 바뀌는 날짜 수정은 §2의 원자적 이관 절차를 따름.
* **백업 권고:** `lastBackupAt`과 이후 신규 입력 건수를 기준으로 시작 시 배너 표시(기본 30일, 설정 변경 가능).

### 8) v2.1 추가 기능 설계 (주별 보고서·무명 자동 번호·달력·직분 목록·기본 헌금 종류)
* **주별 보고서 (종합 보고서의 기간 `WEEK`: `useReportFilters`, `reports/WeeklySummary.tsx`, `domain/weekly.ts`, `excelService.buildWeeklyWorkbook`):**
  * `PeriodType`에 `'WEEK'`를 추가했습니다. 기간이 `WEEK`이면 `monthsOfPeriod`는 빈 목록을 반환하고, `useReportFilters.donations`는 월 필터 대신 **주 범위(시작~종료)** 로 걸러 `SummaryTab`이 `WeeklySummary`(성도명 × 헌금 종류)로 분기합니다. 개인별·세대별 탭 등 `f.donations`를 쓰는 화면은 자동으로 선택 주만 대상으로 합니다.
  * 기준 날짜 기본값은 `lastSunday()`(입력 화면과 동일)이며 `setPeriodType('WEEK')` 때마다 초기화합니다. 집계 기간은 `weekRangeOf(date)` = 해당 날짜가 속한 주의 일요일~토요일이며, 연말·연초에 걸치면 시작·종료 연도 샤드를 모두 `ensureYear` 후 합칩니다.
  * 날짜 입력 도중의 잘못된 값으로 집계가 깨지지 않도록 입력 텍스트(`weekDate`)와 **마지막 유효 날짜(기준)** 를 분리해 관리합니다.
  * `buildWeeklyMatrix(donations, types, range)` → `{ columns, rows, columnTotals, total, count }`. 열은 활성 종류 + 해당 주에 사용된 비활성 종류(`sortOrder` 순) + 장부에만 있는 알 수 없는 종류(`(삭제된 종류)`, 합계 일치 보장). 행 키는 `memberId`(동명이인 분리) 또는 `anon:${donorDisplayName}`(무명 같은 표기명 합산), 정렬은 성도 가나다순 → 무명 번호순(`localeCompare(..., { numeric: true })`).
  * **엑셀 (`buildWeeklyWorkbook`)**: Sheet 1 `주별헌금보고서`(헤더 `성도명 | 종류… | 합계`, 본문 금액은 값, 행·열·총합계는 `SUM` 수식 + `result` 캐시, 가로 A4 폭 맞춤) + Sheet 2 `주간상세내역`(날짜·표기명·종류·금액·메모). 모든 텍스트 셀은 `sanitizeCellText`를 거칩니다. 본문을 `SUMIFS`가 아닌 값으로 둔 이유: 행 키가 `memberId`라 같은 이름의 동명이인을 이름 기준 `SUMIFS`로 합치면 오집계되기 때문입니다. 파일명은 `주별헌금보고서_{시작}_{종료}.xlsx`(세대 기준 무관).
  * 주별 선택 시 연도 선택은 숨기고 도구 모음(날짜 선택, 이전/다음 주, 이번 주)을 표시합니다. 인쇄는 기존 Print CSS(`no-print`, 하단 `PrintFooter`)를 그대로 사용하며, 본문 자체 제목이 있어 인쇄 전용 제목은 중복 출력하지 않습니다. 저장 데이터·`BackupEnvelope`·`schemaVersion`은 변경하지 않습니다.
* **한글 기본 입력 (`domain/hangul.ts`; v2.1 검색창 → v2.2 모든 한글 텍스트 입력 칸):**
  * 웹/Electron 렌더러는 Windows IME의 한/영 상태를 읽거나 바꿀 수 없습니다(`ime-mode`는 폐기됨). 대신 입력값에 영문자가 있으면 `latinToHangul(value)`가 **전체 문자열을 두벌식 자모로 분해 → 재조합**합니다.
  * Shift 키(`Q W E R T O P` = ㅃ ㅉ ㄸ ㄲ ㅆ ㅒ ㅖ), 복합 모음(ㅘ ㅙ ㅚ ㅝ ㅞ ㅟ ㅢ), 겹받침(ㄳ ㄵ ㄶ ㄺ ㄻ ㄼ ㄽ ㄾ ㄿ ㅀ ㅄ)을 지원하고, 받침 뒤에 모음이 오면 받침(겹받침은 뒤쪽)이 다음 글자의 초성으로 넘어갑니다. 초성만 입력(`rct` → `ㄱㅊㅅ`)해도 기존 초성 검색과 그대로 연동됩니다.
  * 한글 IME 조합 중인 값에는 영문자가 없으므로 영향이 없고, 이미 입력된 한글 뒤에 영문을 이어 쳐도 한 글자로 조합됩니다. 숫자·공백·기호는 조합 경계로 그대로 둡니다. 한계: 영문 이름 성도는 영문 검색이 되지 않습니다.
* **무명 자동 번호 (`domain/anonymous.ts`, `DonationContext.useNextAnonymousName`):**
  * `nextAnonymousName(shard, date)` = 해당 날짜에서 `memberId === null` 이고 `/^무명(\d+)$/`에 맞는 표기명의 최대 번호 + 1.
  * 카운터를 영속화하지 않으므로 삭제·되돌리기·날짜 변경과 항상 일치합니다. 한 봉투가 종류별 여러 레코드로 저장돼도 같은 번호이므로 최대값 방식으로 안전합니다.
  * 훅은 문자열만 셀렉터로 구독(`use-context-selector`)하므로 번호가 바뀔 때만 리렌더됩니다. 입력 화면 상태 `anonNameEdit: string | null`에서 `null`은 자동 번호, 문자열은 사용자가 고친 값이며 저장 시 공백이면 자동 번호로 대체합니다.
* **달력 선택기 (`shared/DatePicker.tsx`, `hooks/useDatePicker.ts`, `domain/calendar.ts`):**
  * 일요일 시작 6주(42칸) 고정 그리드. 일요일 열과 요일 머리글 `일`을 `text-red-600`(이전/다음 달 날짜는 연한 빨강), 선택일은 파란 배경, 오늘은 링 강조.
  * 입력 칸은 숫자만 받아 `YYYY-MM-DD`로 자동 정리(`formatDateInput`)하며 형식 검증은 기존처럼 소비하는 쪽(`isValidDateString`, `validateDraft`)이 수행합니다. 상위 컴포넌트의 값·핸들러 계약(`string`)은 `<input type="date">`와 동일해 교체 영향이 없습니다.
  * **배치:** 일반 화면은 입력 칸 아래에 `absolute`로 겹쳐 띄웁니다. Radix `Dialog` 안에서는 콘텐츠의 `overflow-y-auto`가 팝업을 잘라내고, `transform` 조상 때문에 `position: fixed`가 어긋나며, 포털로 빼면 포커스 트랩·바깥 클릭 감지와 충돌합니다. 따라서 모달 안(`inline` 속성: 헌금 수정 모달, 성도 등록/수정·빠른 등록 모달의 생년월일)에서는 달력을 흐름 안에 펼쳐 모달 높이가 함께 늘어나게 합니다.
  * 바깥 `mousedown`·`Esc`로 닫고, 달력 버튼은 `tabIndex={-1}`로 기존 Tab/Enter 입력 흐름을 방해하지 않습니다. 적용 위치: 헌금 날짜, 헌금 수정 모달, 성도 생년월일, 주별 보고서.
* **직분 선택 (`domain/positions.ts`, `useMemberForm`):** `POSITIONS = [목사, 전도사, 집사, 권사]`, 기본값 빈 문자열(직분 없음, v2.15에서 '성도' 제거). 편집 대상의 기존 직분이 목록 밖이면 `positionOptions(initial)`이 마지막 항목으로 추가해 유실을 막습니다(목록은 폼 초기값 기준으로 고정). 명단 가져오기(`memberImportService`)의 직분은 기존처럼 자유 텍스트를 받습니다.
* **기본 헌금 종류 (`domain/offeringDefaults.ts`, `OfferingTypeContext.reload`):**
  * 신규 설치 시드: 건축헌금 `[1만, 5만, 10만, 50만, 100만]`, 선교헌금 `[1만, 3만, 5만, 10만]`, 모두 `PRIMARY`.
  * 기존 설치: `meta_migration_offering_v21` 플래그가 없을 때 **한 번만** `migrateOfferingTypesV21`을 `transact`로 실행합니다. `건축헌금`/`선교헌금`이 `DROPDOWN`이고 `quickAmounts`가 비어 있는 경우(= 이전 기본값 그대로)에만 변경하며, 교회가 직접 바꾼 항목은 건드리지 않습니다. 플래그 키는 백업 대상이 아니므로 복원된 데이터에 대해 재보정되지 않습니다.

### 9) v2.2 추가 기능 설계 (한글 입력 전면 적용·설명서·툴팁·기본값 보정)
* **한글 자동 변환 전면 적용:** `toKoreanInput(value)`는 모듈 스위치(`setHangulAutoConvert`)가 켜져 있을 때만 `latinToHangul`을 적용합니다. 스위치는 `AppSettings.hangulAutoConvert`(기본 `true`)와 `SettingsProvider`의 `useEffect`로 동기화되며(설정 변경은 `BroadcastChannel`로 다른 창에도 전파), 순수 함수 `latinToHangul`은 테스트 용이성을 위해 설정에 의존하지 않습니다.
  * 적용 칸(`onChange`에서 호출, `lang="ko"` 병기): 성도 검색(헌금 입력·성도 정보·개인별 조회), 성도 이름, 무명/방문자 표기명, 헌금 메모, 헌금 수정 모달(표기명·메모·사유), 헌금 명칭. **제외:** 이메일, 폴더 경로, 금액·계수 금액·정렬 순서·백업 주기, 날짜, 연락처 뒷자리, 금액 단추 목록. 한계: 입력 중간 위치에서 영문을 끼워 넣으면 변환 후 커서가 끝으로 이동할 수 있습니다.
* **1회 보정 마이그레이션 (`domain/migrations.ts`):** 모두 `transact`로 처리하고 완료 플래그를 같은 트랜잭션에 기록합니다.
  * `migrateOfferingTypesV22`: `건축헌금`(1천·5천·1만·5만·10만·50만)·`선교헌금`(1천·5천·1만·5만·10만)의 `quickAmounts`에 빠진 값만 합집합으로 추가·정렬합니다. 플래그 `meta_migration_offering_v22`. v2.1 보정과 같은 `transact`에서 순서대로(v2.1 → v2.2) 적용하며, 신규 설치 시드는 두 플래그를 함께 기록합니다.
  * `migrateSettingsV22`: 저장된 `largeAmountThreshold`가 이전 기본값 `100_000_000`일 때만 `10_000_000`으로 바꿉니다(직접 바꾼 값 유지). 플래그 `meta_migration_settings_v22`, `SettingsProvider.load`에서 실행.
  * 플래그 키는 백업 대상이 아니므로 복원된 데이터에 대해 재보정되지 않습니다.
* **툴팁 (`shared/InfoTip.tsx`):** Radix 툴팁 패키지를 추가하지 않고 Tailwind `group-hover`/`group-focus-within`으로 구현했습니다. 버튼(키보드 포커스 가능) + `role="tooltip"` + `aria-describedby`로 접근성을 유지하며, 설정 화면의 "전체 백업 · 복원"·"한글 자동 변환" 안내에 사용합니다.
* **사용 설명서 (`pages/help/`):** `PageKey`에 `help`를 추가하고 `PAGES`의 마지막 메뉴로 노출합니다. 내용은 `helpContent.ts`의 `HelpSection[]`(섹션 → 항목 → 문단) 정적 데이터이고 `HelpPage`는 렌더만 담당하며, 목차 이동·활성 항목은 `useHelpPage`가 처리합니다. 저장소·네트워크를 사용하지 않습니다.
* **인쇄 결재란 제거:** `PrintSignature`를 삭제하고 출력일 표시용 `PrintFooter`로 대체했다가, v2.8에서 이를 상단 한 줄 `PrintHeader`(출력일시)로 통합했습니다. 엑셀 시트의 결재 칸은 v2.3에서 함께 제거했습니다.

### 10) v2.3 추가 기능 설계 (입력 편의·표 고정·글자 크기·엑셀 결재란 제거)

* **되돌리기 단추:** 저장 성공 메시지만 `undoable: true`를 가집니다. 페이지는 `message.undoable && canUndo`일 때만 `Notice`의 `action`(`되돌리기`)을 넘기며, 되돌림·오류 메시지에는 붙지 않습니다. 동작은 기존 `undoLast`(되돌리기 단위=저장 묶음)와 동일해 감사로그·무명 번호 재사용 규칙이 그대로 유지됩니다.
* **주 단위 날짜 이동:** `prevWeek/nextWeek`는 현재 날짜가 유효할 때만 `shiftWeek(date, ±1)`(7일)로 이동하고, 유효하지 않은 입력이면 `lastSunday()`로 복구합니다. 연도 경계는 기존 `ensureYear` 효과가 샤드를 보장합니다.
* **한글 금액 (`amountToKorean`):** 4자리 묶음 + 만·억·조 단위로 읽으며 십·백·천 앞의 '일'은 생략, `만`은 단독이면 "만", `억`·`조`는 "일억/일조"로 읽습니다. 0·음수·비안전 정수는 빈 문자열입니다. `KoreanAmount`는 `parseAmount`가 `ok`일 때만 렌더하며 저장 값·검증에는 관여하지 않습니다.
* **표 고정:** `WeeklySummary`는 표를 `max-h-[65vh] overflow-auto`로 감싸 `th`(top)·첫 열(left)을 `sticky`로 고정합니다. 인쇄에서는 `print:max-h-none print:overflow-visible print:static`으로 풀고, `thead`를 `table-header-group`으로 지정해 페이지마다 머리글을 반복합니다.
* **현금 계수 접근성:** `tabIndex={-1}`을 제거하고 `id="cash-count-input"`, 검색 칸에 `id="member-search-input"`을 부여했습니다. 전역 `F4`(모달이 없을 때)가 계수 칸으로, 계수 칸의 `Enter`가 검색 칸으로 포커스를 옮깁니다.
* **글자 크기:** `fontScale`은 설정 화면에서 즉시 `update`되며 `SettingsProvider`의 효과가 루트 글자 크기를 `''`/`112.5%`/`125%`로 설정합니다. Tailwind 유틸리티가 `rem` 기반이라 화면 전체가 함께 커지고, 인쇄용 레이아웃은 별도 처리하지 않습니다(필요 시 보통 크기에서 인쇄).
* **엑셀 결재란 제거:** `종합결산요약`·`주별헌금보고서` 시트의 `결재/담당/재정부장/당회장` 블록(빈 줄 포함)을 삭제했습니다. 열 너비 자동 맞춤·페이지 설정은 그대로입니다.
* **기타 정정:** `positionOptions` 테스트 기대값을 구현(공백 제거 후 비교)에 맞게 바로잡았습니다.

### 11) v2.4 변경 (십일조 단추·금액 단추 누적)

* **십일조 단추 보정:** `V23_REQUIRED_QUICK_AMOUNTS = { 십일조: [10만, 20만, 30만, 40만, 50만] }`를 기존 금액과 합집합으로 정렬해 추가합니다(직접 설정한 금액은 유지). `OfferingTypeProvider.reload`가 v2.1→v2.2→v2.4 순서로 같은 `transact` 안에서 실행하고, 신규 시드는 세 플래그를 함께 기록합니다. 기본 시드 `DEFAULT_OFFERING_TYPES`의 십일조도 같은 값입니다. (플래그 이름 `v23`은 보정 순번이며 화면 버전 v2.4와 다릅니다.)
* **금액 단추 누적:** `addQuickAmount(current, add)`는 `parseAmount`로 현재 값을 읽어(비었거나 올바르지 않으면 0) 합산 후 `formatAmountInput`으로 표기합니다. 합계가 안전 정수가 아니거나 15자리를 넘으면 현재 값을 그대로 반환해 잘림으로 인한 오입력을 막습니다. 큰 금액 확인·한글 금액 표기는 합산된 입력값 기준으로 그대로 동작합니다.
* **[지움]:** 값이 있을 때만 단추 줄 끝에 표시되며 `tabIndex={-1}`·`onMouseDown` 포커스 유지로 단추와 같은 방식입니다.

### 12) v2.5 변경 (사용성 개선 묶음)

* **저장 메시지 위치:** `DonationInputPage`가 `DailyTotalsBar` 아래에 `min-h-[2.75rem] aria-live="polite"` 컨테이너를 두고 `Notice`(+`action`)를 렌더합니다. 메시지 유무와 관계없이 높이가 고정이라 폼이 위아래로 흔들리지 않습니다.
* **Ctrl+Enter 저장:** `useDonationInput`의 `window keydown` 핸들러가 처리하며, `isFormEmpty`/모달 상태와 무관하게 `requestSave()`를 호출합니다(검증·큰 금액·중복 확인 흐름은 동일). 필드 단위 `onFieldKeyDown`/`onSearchKeyDown`은 `ctrlKey/metaKey`면 반환해 이중 처리를 막습니다. 수정창처럼 이 훅이 모르는 대화상자가 열려 있을 때 F2·F4·Ctrl+Z가 뒤에서 동작하지 않도록 DOM에서 열린 대화상자를 확인합니다. 달력 팝업(`role="dialog"`이지만 `data-state` 없음)은 해당하지 않습니다.
* **최근 입력 수정:** `useHistoryItems`는 저장 묶음의 `createdIds`(+`mergedBefore`의 id)를 전체 샤드에서 찾아 **현재 값**으로 줄을 만듭니다(수정 반영·연도 이동 대응). 찾지 못하면 저장 당시 `lines`를 읽기 전용으로 표시합니다. [수정]은 보고서와 같은 `useDonationEditor`/`DonationEditModal`을 사용하므로 사유 필수·감사로그 규칙이 동일합니다.
* **요일 표시:** `weekdayLabelOf(date)`는 `YYYY-MM-DD`가 유효할 때만 `{label, isSunday}`를 반환합니다. `DatePicker`는 입력 칸과 달력 버튼 사이에 `(일)` 형태로 표시합니다(모달 안 `inline` 모드 포함).
* **성도 정렬/비활성화:** `memberComparator(key, dir)`는 값이 없는 항목을 항상 뒤로, 동률은 이름 순으로 처리합니다. `useMembersPage`는 `sort`/`confirming` 상태를 가지며, 확인 후에만 `setActive`를 호출합니다.
* **설정 화면:** `dirty = email/threshold/reminderDays가 저장된 설정과 다름`. [설정 저장]은 `dirty`일 때만 활성입니다. 즉시 적용 항목은 기존처럼 `update()`를 바로 호출합니다.
* **접근성:** 주 메뉴 `nav[aria-label]` + `aria-current="page"`, 보고서 탭 `role=tablist/tab` + `aria-selected`, 토글 단추 `aria-pressed`, 성도 열 제목 `aria-sort`, 개인별 검색 `role=combobox/listbox/option`.

### 13) v2.6 로직 점검 결과 (수정한 문제와 남겨 둔 사항)

* **수정 — 연도가 바뀐 내역의 되돌리기:** 저장 직후 [수정]으로 날짜를 다른 연도로 옮기면, 이전 `undoLast`는 저장 연도 샤드만 찾아 아무것도 지우지 못한 채 이력만 비웠습니다. 이제 저장 연도를 먼저, 나머지 연도를 뒤에 찾고, 합산 되돌리기는 원래 날짜의 연도 장부로 복원하며, 변경된 샤드·감사로그 키만 한 트랜잭션으로 씁니다.
* **수정 — 오래된 불러오기가 최신 값을 덮어쓰는 경쟁:** `ensureYear`는 `getItem` 결과를 `setShards`로 넣기 때문에, 불러오는 동안 저장이 먼저 반영되면 저장 이전 목록으로 되돌려질 수 있었습니다. 이미 값이 있으면 건너뜁니다(감사로그 동일).
* **수정 — 설정 `dirty` 고착:** 이메일 앞뒤 공백·백업 주기 `030` 같은 입력은 저장 시 정규화되어 화면 값과 저장값 문자열이 달라 [설정 저장]이 계속 활성이었습니다. 정규화한 값(숫자)으로 비교합니다.
* **개선:** 세대원이 남은 세대주는 확인창을 띄우기 전에 `canDeactivate` 사유를 안내하고, 최근 입력의 합산 줄은 현재 합계이므로 "(합산 후 금액)"으로 표기합니다.
* **남겨 둔 사항(설계상 동작):** (1) 새로 저장한 내역을 되돌리면 생성 기록이 없는데도 감사로그에 `DELETE(입력 직후 되돌리기)`가 남습니다. (2) 백업 복원은 설정과 1회 보정 플래그를 포함하지 않으므로, v2.4 이전 백업을 복원하면 십일조 30만·40만 단추가 없는 상태로 돌아옵니다(헌금 종류 화면에서 추가 가능). (3) 주별 보기에서는 연도 선택이 숨겨져 [수정·삭제 이력] 탭이 현재 연도 기준으로 열립니다. (4) 영문 자판→한글 변환은 영어를 그대로 써야 하는 메모에서 설정으로 끄도록 했습니다.

### 14) v2.7 변경 (인쇄 양식·파일 열기·이력 범위·기본 보고서)

* **인쇄 머리글/바닥글 제거:** Chromium(Electron·브라우저)이 인쇄 여백 안에 넣는 날짜·문서 제목·URL·쪽번호는 CSS로 직접 끌 수 없고 `@page` 여백이 0이면 표시되지 않습니다. 그래서 `@page margin: 0`으로 두고, 실제 여백은 `App`의 `main`에 `print:p-[12mm]`로 줍니다. 방향은 `size: A4 landscape`입니다. 사용자의 인쇄 대화상자에서 "머리글 및 바닥글"을 켜 두었더라도 여백 0에서는 들어갈 자리가 없어 나오지 않습니다(다른 용지·여백을 직접 고르면 다시 나올 수 있음).
* **인쇄 강조 스타일:** `.rpt-table`(종합 요약·주별 표)은 인쇄 시 `th` 회색 바탕(#d1d5db)·검은 굵은 글씨·1.5px 테두리, `.rpt-name`(성도명/헌금 종류 열)과 `.rpt-total`(합계 열)은 굵은 글씨+옅은 회색, `.rpt-total-row`(합계 행)는 위·아래 2px 검은 테두리+회색 바탕입니다. 배경이 인쇄되도록 `print-color-adjust: exact`를 전역 적용합니다. 개인별 탭은 머리글 행·합계 칩에 `print:` 유틸리티로 같은 원칙을 적용합니다.
* **저장 파일 열기(Electron):** `will-download` 핸들러가 완료(`completed`)된 `.xlsx`의 실제 저장 경로(`getSavePath()`)를 `savedFiles`에 보관하고 렌더러로 `{path, name}`을 보냅니다. `preload`는 `openFile/showInFolder/onDownloadDone`만 노출하며, main의 `file:open`(`shell.openPath`)·`file:show`(`showItemInFolder`)는 `savedFiles`에 있는 경로만 처리해 렌더러가 임의 파일을 실행하지 못하게 합니다. 사용자가 저장 대화상자를 취소하면(`cancelled`) 이벤트가 없어 단추가 나타나지 않습니다. 일반 브라우저에는 `window.desktop`이 없어 단추를 표시하지 않습니다.
* **이력 범위:** `ReportPeriod { isWeek, week, year, months }`로 현재 보고서를 표현하고 `auditLogsForPeriod`가 변경 전·후 스냅샷 날짜 중 하나라도 기간에 속하는 이력을 최신순으로 반환합니다. 이력은 새 연도의 감사 장부에 기록되므로(연도 이동 수정) `useAuditLogTab`은 `useDonationYears()`의 모든 연도를 `ensureAuditYear`로 불러온 뒤 필터합니다.
* **보고서 기본값:** `useReportFilters`의 초기 `periodType='WEEK'`, 주 기준 날짜는 `todayString()`입니다(오늘이 속한 일~토 주). 일요일이든 아니든 `weekRangeOf(today)`가 현재 주를 돌려주므로 이전의 `lastSunday()`와 같은 주이지만 입력 칸에 오늘 날짜가 보입니다. 훅이 `ReportsPage`에 묶여 있어 메뉴를 나갔다 오면 항상 이 기본값으로 시작합니다.

### 15) v2.8 인쇄 양식 조정

* **PrintHeader:** 화면에서는 `display:none`(`.print-flex`), 인쇄에서는 `display:flex`. 왼쪽 `h2`(제목·기간), 오른쪽 `dl`(`주간 총 헌금/건수/인원` 등 + `출력일시`)로 한 줄에 둡니다. 종합 보고서(주별·연/분기/월)는 표 바로 위에 자체 `PrintHeader`를 두고, 개인별·이력 탭은 `ReportsPage`가 제목만 있는 `PrintHeader`를 둡니다. 화면용 제목·요약 카드는 `no-print`.
* **출력일시:** `usePrintStamp`가 `beforeprint`에서 `flushSync(setNow(new Date()))`로 인쇄 시작 시각을 반영해 화면을 오래 열어 둔 경우에도 인쇄 시점 시각이 찍힙니다. 형식은 `yyyy-MM-dd (요일) HH:mm`.
* **쪽마다 여백:** 머리글·바닥글 제거를 위해 `@page margin:0`을 유지하면 2쪽 이후에는 `main` 패딩이 적용되지 않으므로, 표의 `thead`(머리글 행 위)와 `tfoot`(`.print-foot`, `table-footer-group`)에 `SpacerRow`를 넣어 쪽마다 5mm 위·아래 여백을 반복합니다(Chromium은 `thead/tfoot`를 쪽마다 반복 출력). 프린터의 인쇄 불가 영역(보통 4~5mm)을 고려한 최소값입니다.
* **압축:** `.rpt-table th/td`에 `font-size: 9.5pt; line-height: 1.25`와 패딩 1.5~2px를 셀 단위로 지정(`.th/.td` 유틸리티가 글자 크기를 직접 지정하므로 표 단위 지정만으로는 적용되지 않음). 인쇄 시뮬레이션에서 행 높이는 약 20px(5.3mm)로 A4 가로 한 쪽에 약 34행입니다.
* **검증 한계:** 인쇄 미리보기를 자동으로 열 수 없어, `@media print` 규칙을 화면에 적용해 레이아웃(헤더 한 줄, 행 높이, 숨김 요소)을 확인했습니다. 실제 쪽 나눔과 프린터 여백은 인쇄해서 확인해야 합니다.

### 16) v2.9 테마·인쇄 색상·날짜 선택 전용

* **화면 테마 구현:** 앱 전체가 Tailwind 색 클래스(`bg-blue-600`, `text-gray-500` 등)를 쓰고 Tailwind 4가 이를 `var(--color-*)`로 컴파일하므로, `index.css`에서 해당 변수만 테마별로 덮어씁니다(회색 9단계·파랑 6단계·slate 3단계·`--color-white`·`--app-bg/--app-fg`). 비계층(unlayered) 규칙이 Tailwind의 `@layer theme`보다 우선하므로 별도 컴포넌트 수정이 없습니다. 기본(속성 없음)이 차분한 블루이고 `:root[data-theme="WARM"|"CALM"]`가 덮어씁니다. 눈이 편안한 테마는 `--color-white`를 `#f6f8f3`으로 두어 흰 카드의 반사광을 줄이고, 밝고 따뜻한 테마는 파랑 계열 변수를 테라코타로 치환합니다.
* **인쇄와의 분리:** 테마 변수는 `@media screen` 안에만 있어 인쇄에서는 Tailwind 기본 팔레트가 쓰입니다. 인쇄 색은 `:root[data-print-theme]`의 `--pt-line/grid/th-bg/th-fg/name-bg/total-bg/title/rule` 8개 변수로만 정해지고 `.rpt-table`, `.rpt-title-bar`, `.rpt-grid-head`, `.rpt-chip(-total)`가 이를 사용합니다. 흑백 값은 v2.8과 동일합니다. 새 인쇄 색을 추가하려면 변수 블록과 `PRINT_THEME_OPTIONS` 항목만 추가하면 됩니다.
* **적용 시점:** `SettingsProvider`의 효과가 `applyTheme()`으로 `html[data-theme][data-print-theme]`를 설정하고 `localStorage`에 같은 값을 기록합니다. `main.tsx`는 렌더 전에 `applyStoredTheme()`로 마지막 값을 먼저 적용해 설정 로드 전의 색 깜빡임을 줄입니다(Electron CSP가 인라인 스크립트를 막으므로 모듈에서 처리). 저장소를 쓸 수 없으면 기본 테마로 시작합니다. 설정 값은 기존 `settings` 키에 합쳐져 저장되며 누락 시 기본값(BLUE/MONO)이 병합되어 마이그레이션이 필요 없습니다.
* **선택 UI:** `ThemePicker`(`role="radiogroup"`/`radio`, `aria-checked`)로 색 점 3개 미리보기와 설명을 보여 줍니다. 화면 테마 3종과 인쇄 4종이 같은 컴포넌트를 씁니다.
* **날짜 선택 전용:** `DatePicker`의 `pickOnly`는 입력을 `readOnly`로 하고 클릭·Enter·Space·ArrowDown에 `openCalendar()`를 호출합니다(훅이 `openCalendar`를 노출). 헌금 입력 화면에서만 사용하며 보고서·수정창은 직접 입력을 유지합니다.
* **검색 칸 폭:** 입력 화면 상단 그리드를 `220px / minmax(0, 26rem)`로 제한했습니다(드롭다운은 같은 컨테이너 폭).

### 17) v2.10 변경 (한글 변환 제거·입력 칸 조정·동명이인 표기)

* **한글 자동 변환 제거:** `latinToHangul`/`toKoreanInput`/`setHangulAutoConvert`와 이를 쓰던 입력 칸(성도 검색 3곳·이름·무명 표기명·메모·수정창 3칸·헌금 명칭)의 `onChange` 래핑, `SettingsContext`의 동기화 효과, 설정 체크 UI와 `hangulAutoConvert` 설정 필드를 모두 삭제했습니다. 저장소의 `settings`에 이전 키가 남아 있어도 `{...DEFAULT_SETTINGS, ...stored}` 병합 시 무시되며 별도 마이그레이션은 필요 없습니다. 한/영 전환은 OS의 한/영 키를 사용합니다. (§8의 한글 변환 설계 설명과 §9의 '한글 자동 변환 전면 적용' 항목은 이력으로만 남습니다.)
* **금액 단추 색:** `.btn-quick`은 `border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 active:bg-blue-200`이며 `blue-*`는 테마별 CSS 변수라 차분한 블루/밝고 따뜻한(테라코타)/눈이 편안한(청록)에서 자동으로 어울리는 색이 됩니다. 이를 위해 세 테마에 `--color-blue-100`을 추가했습니다. [지움]은 기존 `.btn`(빨강 글씨) 유지.
* **입력 칸:** 메모 `input`은 `max-w-md`(28rem, 한글 약 30자)이고 `maxLength`를 두지 않습니다. 기타 선택 `select`는 `w-28`, 첫 옵션 문구는 "기타 선택".
* **동명이인 표기:** `duplicateNames(members)`는 비활성 성도를 포함해 이름이 겹치는 이름 집합을 만들고, `nameDisambiguator(member, dup)`가 연락처 뒷4자리 → 직분 순으로 구분 값을 돌려줍니다(둘 다 없으면 null). `useNameTag()`는 `memberId → 표기 | null`을 반환하며 무명/방문자(memberId 없음)는 항상 null입니다. 표시 이름은 내역에 저장된 표기명(`donorDisplayName`)을 그대로 쓰고, 구분 표기는 현재 성도 정보에서 가져옵니다. 이력(`AuditDonationView`)은 문자열 대신 날짜·이름·표기·종류·금액·메모로 나눠 표기만 작게 렌더링합니다. 엑셀(.xlsx) 시트는 변경하지 않았습니다(이름 열이 `SUMIFS` 조건 등에 쓰이므로 표기를 섞으면 집계가 깨질 수 있음).
* **인쇄 간격:** 제목 줄 아래 여백(12px)과 표 머리글 위 반복 여백 행(5mm≈19px)이 합쳐 약 31px였던 간격을, 표 래퍼에 `print:-mt-4`(−16px)를 주어 약 15px로 줄였습니다. 2쪽 이후는 마진이 적용되지 않아 반복 여백 행(5mm)이 그대로 유지됩니다. 인쇄 시뮬레이션은 Tailwind의 `print:` 유틸리티가 `@layer` 안에 있으므로 레이어 블록까지 순회해 적용했습니다(이전 시뮬레이션은 직접 작성한 `@media print` 규칙만 반영함).

### 18) v2.11 전체 입력 내역 탭 (수정·삭제 경로 보강)

* **문제:** 헌금 수정·삭제 진입점이 (a) 입력 화면 "최근 입력"(이번 실행 한정), (b) 개인별·세대별 내역(성도 검색 필요)뿐이어서, **무명/방문자 내역은 앱을 다시 켠 뒤 고칠 수 없었고** 주별 표는 같은 표기명의 무명을 합산해 낱개 내역을 볼 수 없었습니다.
* **구현:** `ReportTab`에 `'LIST'`를 추가하고 `ListTab`이 `ReportFilters.donations`(현재 기간 필터 결과)를 그대로 사용합니다. `useDonationListReport`는 `filterByDonor`(표기명 부분 일치, 한글 초성만 입력하면 초성 비교)와 `sortForList`(날짜 내림차순 → `createdAt` 내림차순)로 행을 만들고 `useNameTag`로 동명이인 표기를 붙입니다. 수정·삭제는 `useDonationEditor`(사유 필수, 연도 이동·감사로그 규칙 동일)를 사용합니다.
* **성능·인쇄:** `PersonalTab`과 같은 `@tanstack/react-virtual` 가상 스크롤(행 36px). 인쇄에서는 스크롤 제한을 풀고 관리 열을 숨기며(`print:grid-cols-…` 5열) `PrintHeader` 제목을 `ReportsPage`가 붙입니다.

### 19) v2.12 보고서 UI 조정과 테스트 데이터 생성기

* **탭 초기화:** `reportKey = isWeek ? 'W:' + week.start : periodType:year:periodValue`이고 `useEffect(() => setTab('SUMMARY'), [reportKey])`입니다. 주 이동·기간 종류/연도/월·분기 변경이 모두 포함되며, 세대 집계 기준 토글·메일/엑셀 작업은 포함하지 않습니다. 한 탭에서 주를 넘겨 가며 보려면 매번 탭을 다시 골라야 하므로, 필요하면 `reportKey`에서 `week.start`를 빼서 '기간 종류 변경 때만 초기화'로 좁힐 수 있습니다.
* **주 날짜:** 초기값·주별 선택 시·[지난 주일] 모두 `lastSunday()`(오늘이 주일이면 오늘). 해당 주(일~토)는 오늘이 속한 주와 같아 v2.7의 `todayString()` 기본값과 집계 범위는 동일하고 입력 칸에 보이는 날짜만 다릅니다. 입력은 `pickOnly`.
* **버튼 테마:** `.btn-accent`는 `border-blue-600 bg-blue-50 text-blue-700 hover:bg-blue-100`으로 테마 변수(blue 계열)를 그대로 따릅니다.
* **테스트 데이터 생성기:** Node 단독 실행 스크립트이며 외부 의존성이 없습니다. 시드 고정 PRNG(mulberry32)로 재현 가능한 성도·가정·내역을 만들고, `BackupEnvelope`(`schemaVersion: 2`, payload의 `JSON.stringify` SHA-256 체크섬)로 기록해 기존 복원 경로(`parseAndValidateBackup` → `replaceAllData`)를 그대로 씁니다. 어제·오늘이 서로 다른 연도(1월 1일)여도 연도 샤드로 나눠 담습니다. `testData.test.ts`가 스크립트를 실행해 ① 앱 검증 통과·건수(150/300/100) ② 참조 무결성(성도·종류 id) ③ 사례 포함 여부 ④ 연도 경계 ⑤ 재현성을 검사합니다.

### 20) v2.13 표 읽기 편의·가상 스크롤 인쇄 보정

* **정렬:** `byName`(`localeCompare('ko', {numeric: true})`)으로 이름순을 정하고, 같은 이름이면 `tieBreak(memberId)` 문자열 비교로 정합니다. `memberOrderKey`는 `연락처4자리|직분순위|id`이며 연락처가 없으면 `'99999'`를 써서 4자리 연락처보다 뒤에 둡니다(`~` 같은 기호는 로캘 비교에서 숫자보다 앞에 오므로 사용하지 않음 — 단위 테스트로 확인). 화면(`useWeeklyMatrix`)과 엑셀(`useReportExport`)이 같은 `useMemberOrderKey()`를 넘겨 순서가 일치합니다.
* **번호·구분선:** 번호는 정렬·필터 후의 표시 순번(1부터)이며 데이터에 저장되지 않습니다. `no % 10 === 0`인 행에 `row-sep` 클래스를 붙여 하단 선을 2px로 키웁니다(화면: gray-400, 인쇄: `--pt-line`). 주별 표는 번호 열(2.5rem)과 성도명 열(4.5rem)을 `sticky left-0 / left-10`으로 고정해 열이 많아 가로 스크롤될 때도 보이게 했습니다.
* **같은 스크롤:** 종합 보고서 표와 전체 입력 내역은 `REPORT_SCROLL`(`max-h-[72vh] overflow-auto`, 인쇄 시 제한 해제)을 공유합니다. 전체 입력 내역은 머리글(30px, `sticky top-0`)을 스크롤 컨테이너 안에 두고 `useVirtualizer({ scrollMargin: 30 })`로 시작 위치를 보정하며 행은 `translateY(item.start - scrollMargin)`로 배치합니다(스크롤 후 번호·머리글 위치를 확인함).
* **인쇄 보정(기존 결함):** 가상 스크롤 목록은 화면에 보이는 행만 DOM에 있어 인쇄 시 목록이 잘렸습니다(전체 입력 내역·개인별 탭). `useIsPrinting`이 `beforeprint`에서 `flushSync`로 `true`를 만들면 전체 행을 렌더하고 `afterprint`에 가상 스크롤로 복귀합니다. 400행 기준 인쇄 상태에서 400행이 모두 그려지는 것을 확인했습니다(이전에는 약 26행).

### 21) v2.14 합계 행 고정·헌금 종류 삭제·기본 종류 추가

* **합계 행 고정:** 표는 `border-collapse: collapse`라 sticky 셀의 테두리가 스크롤 중 사라지므로 `shadow-[0_-1px_0_0_var(--color-gray-300)]`로 윗선을 그립니다. 합계 행의 모든 셀이 `sticky bottom-0 z-10`이며 번호·성도명 칸은 가로 고정(`left-0/left-10`)과 겹치도록 `z-20`입니다. 머리글(`top-0`)과 합쳐 스크롤 위치(맨 위/중간/맨 아래)와 무관하게 위·아래가 고정됨을 확인했습니다. 인쇄에서는 `print:static`입니다.
* **인쇄·엑셀 성도명:** 화면용 `max-w-[4.5rem]`은 인쇄에서 비계층 규칙(`th.rpt-name-col, td.rpt-name { width: 9.5rem; max-width: none; white-space: nowrap }`)이 덮어씁니다. 엑셀은 이전에 제목 행 때문에 열 폭이 정해지거나 한글 폭 계산에 여유가 없어 잘릴 수 있었으므로, `fitNameColumn(ws, col, names, {min:18, max:60, extra:6})`가 이름 데이터만으로 폭을 계산합니다(주별 1·2번 시트, 기간 보고서의 상세 시트 표기명·세대 열, 세대 집계 시트 세대·구성원 열).
* **기본 종류 추가:** `DEFAULT_OFFERING_TYPES`에 구제헌금(PRIMARY, 6종 금액, 정렬 6)·특별헌금(DROPDOWN, 정렬 7)을 추가했고 신규 시드는 `v24` 플래그를 함께 기록합니다. 기존 설치본은 `migrateOfferingTypesV24`가 이름이 없는 종류만 `newId()`와 `max(sortOrder)+n`으로 추가하며, 같은 이름이 있으면 활성 여부·노출 영역·금액을 포함해 그대로 둡니다(교회 설정 우선). 마이그레이션은 v2.1→v2.2→v2.4→v2.14 순서로 한 트랜잭션에서 실행됩니다.
* **종류 삭제:** `countUsage`(읽기 전용, 안내용)와 `remove`(검사+삭제를 한 `transact`에서 수행)로 분리했습니다. 사용 건수는 `listDonationYears()`의 모든 샤드에서 `offeringTypeId`가 같은 내역 수이며 감사 로그의 스냅샷은 세지 않습니다(삭제된 종류의 이력은 `(삭제된 종류)`로 표시). UI는 사용 중이면 확인 버튼만 있는 안내 `Modal`, 아니면 취소/삭제 확인 `Modal`입니다. 비활성 종류도 같은 규칙입니다.
* **성도 목록:** 번호는 표시 순번이며 `birthDate`는 데이터·폼·가져오기에는 남아 있고 목록 열만 뺐습니다(정렬 키 `birthDate`는 도메인 함수에 남아 있으나 화면에서는 쓰지 않음).

