# 청지기 장부 (Steward Ledger) v1.0

인터넷 없이 쓰는 **교회 헌금 기록·결산 프로그램**입니다. Windows PC 전용(Electron)이며 모든 데이터는 이 컴퓨터 안에만 저장됩니다.

- 시연 페이지: https://princeps1986-dotcom.github.io/steward-ledger/ (PC 브라우저 권장, 설정 정보 → [시연 데이터 불러오기])
- 무엇을 만드는가: [PRD.md](PRD.md)
- 어떻게 만들었는가: [ARCHITECTURE.md](ARCHITECTURE.md)
- 사용법: 앱 안의 **[사용 설명서]** 메뉴

## 주요 기능
- 키보드만으로 빠른 헌금 입력, 같은 헌금 합산, 되돌리기(Ctrl+Z), 현금 계수 대조
- 주별·월별·분기별·연도별 보고서, 인쇄(A4 가로), 엑셀 저장, 메일 저장
- 수정·삭제 이력 자동 기록, 납부 당시 세대 기준 집계
- 연도별 백업·복원(다른 PC 백업도 중복 없이 합침), 종료 시 자동 백업

## 개발

```bash
npm install
npm run dev        # 개발 서버 http://localhost:5173
npm test           # 자동 테스트
npm run build      # 타입 검사 + 웹 빌드
npm run dist       # Windows 설치 파일 (release/)
```

시험용 데이터는 `npm run testdata`로 백업 파일을 만든 뒤 [백업 파일 복원]으로 불러옵니다. 자세한 명령과 배포 방법은 [ARCHITECTURE.md §18](ARCHITECTURE.md#18-빌드--실행--배포)을 보세요.
