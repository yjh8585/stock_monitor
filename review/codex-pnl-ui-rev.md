**리뷰 결과**

전체적으로 요구사항의 큰 방향은 맞습니다. 점수로 보면 **78~82점 수준**입니다. 다만 아래 이슈들은 병합 전에 고치는 게 좋습니다.

**Findings**

- **P1: 2차원 정렬이 parent별 매출순이 아닙니다.**  
  [DimensionSection.tsx](</mnt/c/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/components/management/pnl/DimensionSection.tsx:80>)의 `revRank`는 dimension별 전역 rank입니다. 그래서 ProductCustomerCross에서 고객 정렬이 “해당 product 안의 고객 매출순”이 아니라 “전체 고객 매출순”으로 됩니다. 요구가 product desc 후 product 내부 customer desc라면 현재 구현은 틀립니다.

- **P1: X=0/Y=0 ReferenceLine이 축 domain 밖이면 안 보일 수 있습니다.**  
  [MarginScatter.tsx](</mnt/c/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/components/management/pnl/MarginScatter.tsx:174>)와 Y축에 domain 설정이 없습니다. 데이터가 전부 양수거나 전부 음수면 [ReferenceLine x=0](</mnt/c/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/components/management/pnl/MarginScatter.tsx:206>) / y=0이 잘릴 수 있습니다. X/Y domain을 `0` 포함으로 강제해야 요구사항을 안정적으로 만족합니다.

- **P2: rowspan이 있는 테이블에서 highlight가 sticky 셀에 반영되지 않습니다.**  
  [PnlTable.tsx](</mnt/c/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/components/management/pnl/PnlTable.tsx:219>)에서 row는 highlight class를 받지만 sticky `<td>`는 [bg-background](</mnt/c/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/components/management/pnl/PnlTable.tsx:247>)로 고정됩니다. 그래서 좌측 병합 셀은 노란 highlight/summary 배경을 덮어버립니다. `StockRow`처럼 sticky cell 배경을 row 상태에 맞춰 계산해야 합니다.

- **P2: `STICKY_LEFT_PX = 96` 고정 offset은 컬럼 폭이 커지면 겹칠 수 있습니다.**  
  [PnlTable.tsx](</mnt/c/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/components/management/pnl/PnlTable.tsx:45>) 기준으로 left offset만 96px 단위인데 실제 셀 width/min-width가 고정되어 있지 않습니다. `text-sm`, 긴 고객명, 제품명에서 sticky 컬럼끼리 겹칠 수 있습니다.

- **P2: rowspan 셀 클릭/강조 대상이 직관과 다를 수 있습니다.**  
  병합된 셀은 첫 번째 owner row에만 존재합니다. 그룹 중간 row를 클릭하면 metric/year 셀만 해당 row로 highlight되고, 병합된 차원 셀은 owner row 상태를 따릅니다. “행 단위 강조”를 기대하면 시각적으로 어긋납니다.

**확인된 부분**

- `computeRowMetas`의 `parentMatch`는 제시한 예시 `['A','x'], ['A','x'], ['A','y'], ['B','x']`에서는 올바르게 동작합니다.
- `getUniqueValuesByRevenue()`는 연간 row 기준 unique 수집 + 해당 연도 매출 desc 정렬 구조라 요구와 대체로 맞습니다.
- `CompanyOverview`의 `dimCount=0` 기본 동작은 문제 없어 보입니다.
- `SilPerformance`의 summary row + `dimCount=2` 방향도 맞습니다.
- 8/9/10 섹션 번호 변경과 lazy mount 4개 적용도 의도와 맞습니다.

`npm run typecheck`는 현재 세션 정책에서 실행이 차단되어 확인하지 못했습니다.