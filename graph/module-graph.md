# 모듈 의존 그래프 (src)

파일 92개 · import 233건 (테스트 파일·타입 전용 import 제외). 화살표는 "A가 B를 import".

```mermaid
flowchart LR
  _root_["(root) (2)"]
  components_pages["components/pages (27)"]
  components_shared["components/shared (9)"]
  contexts["contexts (6)"]
  hooks["hooks (17)"]
  services["services (2)"]
  services_backup["services/backup (4)"]
  services_demo["services/demo (1)"]
  services_domain["services/domain (18)"]
  services_excel["services/excel (3)"]
  services_import["services/import (1)"]
  services_storage["services/storage (2)"]
  _root_ -->|6| components_pages
  _root_ -->|3| components_shared
  _root_ -->|1| contexts
  _root_ -->|1| hooks
  _root_ -->|1| services
  _root_ -->|1| services_storage
  components_pages -->|20| components_shared
  components_pages -->|25| hooks
  components_pages -->|13| services_domain
  components_shared -->|1| hooks
  contexts -->|1| services
  contexts -->|12| services_domain
  contexts -->|8| services_storage
  hooks -->|1| components_pages
  hooks -->|27| contexts
  hooks -->|4| services
  hooks -->|4| services_backup
  hooks -->|1| services_demo
  hooks -->|28| services_domain
  hooks -->|5| services_excel
  hooks -->|1| services_import
  services_backup -->|2| contexts
  services_backup -->|1| services
  services_backup -->|3| services_domain
  services_backup -->|1| services_excel
  services_backup -->|2| services_storage
  services_demo -->|1| services_domain
  services_excel -->|2| services_domain
  services_import -->|4| services_domain
```

## 가장 많이 import되는 파일 Top 10

| 파일 | 피참조 수 |
|---|---|
| services/domain/amount.ts | 15 |
| services/domain/dates.ts | 13 |
| contexts/MemberContext.tsx | 10 |
| components/shared/Modal.tsx | 9 |
| services/domain/positions.ts | 9 |
| contexts/DonationContext.tsx | 8 |
| contexts/OfferingTypeContext.tsx | 8 |
| services/domain/ids.ts | 8 |
| services/storage/storageService.ts | 7 |
| hooks/useReports.ts | 6 |

## 서로 import하는 파일 쌍(순환)

없음
