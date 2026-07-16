import type { PlantEvent } from './types';

/**
 * 스텔란티스 북미 공장 가동 이벤트 — **수동 큐레이션 데이터**.
 *
 * 이 파일은 수집 스크립트가 만들지 않는다. `scripts/`의 자동 수집(MarkLines·Cox·IR)과 달리
 * 사람이 웹 검색으로 찾아 손으로 적은 목록이며, 재실행해도 자동으로 갱신되지 않는다.
 * 차트의 숫자(생산·소매·출하·재고)가 "무엇이 일어났는가"를 말해준다면, 이 목록은
 * "왜 그랬는가"를 붙이는 주석 역할이다.
 *
 * ## 신뢰 수준
 * 각 항목은 (1) 웹 검색으로 발견한 뒤 (2) 별도 검증 단계에서 **반증을 시도하며**
 * 교차검증을 거쳤다. 검증에서 살아남지 못한 항목(날짜가 한 달 어긋남, 보도일을 사건일로
 * 오인, 출처가 주장과 반대 내용을 담음 등)은 이 목록에 없다. 검증 과정에서 잡힌 오류
 * — 근거 없는 최상급 수식, 회사 공식 사유와 다른 인과 서술, WARN 예고치를 확정 실적처럼
 * 적은 것 등 — 는 `summary`·`statedReason`에 반영해 정정했다.
 *
 * `summary`는 UI 타임라인 카드에 그대로 들어가므로 1~2문장으로 압축돼 있다.
 * 검증에서 확인된 사실만 담고, 확인 못 한 수치·수식은 뺐다.
 *
 * ## 갱신 방법
 * - 새 이벤트는 **반드시 출처 URL과 함께** 손으로 추가한다. 출처 없는 이벤트는 넣지 않는다.
 * - 출처 신뢰도 우선순위: 공식 보도자료 > 주요 매체(Automotive News·Detroit News·Reuters·CBC)
 *   > 블로그·집계 사이트. 같은 사건이 여러 곳에 실렸으면 위쪽을 남긴다.
 * - **보도일 ≠ 사건 발생일**. `startYearMonth`는 사건이 일어난(또는 발표된) 달이고,
 *   `sourceDate`는 기사 게재일이다. 이 둘을 섞는 것이 이 데이터셋에서 가장 흔한 오류였다.
 * - 발표만 되고 **집행되지 않은** 조치(철회·연기)도 사실이므로 남기되, 그 사실을 `summary`에
 *   명시한다. 집행된 사건으로 읽히면 생산·매출 전망이 왜곡된다.
 * - `models`가 빈 배열인 것은 차종이 배정되지 않은 공장(유휴 상태)이거나 차종 무관 이벤트다.
 *
 * ## eventType 의미
 * - `downtime` — 생산 일시 중단(주 단위 셧다운, 공급 차질, 관세 대응 등).
 * - `shift_cut` — 교대 축소(3교대→2교대 등)로 상시 생산능력이 줄어드는 조치.
 * - `shift_add` — 교대 증설로 생산능력이 늘어나는 조치.
 * - `retooling` — 차종 전환을 위한 설비 개조·투자.
 * - `layoff` — 인력 해고·휴업(생산 중단과 별개로 집계되는 고용 조치).
 * - `closure` — 공장 폐쇄(현재 해당 항목 없음 — 유휴 공장도 폐쇄가 아닌 `operational pause`).
 * - `restart` — 중단됐던 가동의 재개, 또는 감축 조치의 철회·복귀.
 * - `production_add` — 신규 물량·라인·엔진 투입으로 생산이 실제로 늘어나는 조치.
 * - `inventory` — 공장이 아니라 **미국 딜러 네트워크의 재고 지표**(Cox 재고일수 등). 화면에서
 *   '재고'로 분류되고 음영으로 강조된다. Cox 자동 수집분(`buildCoxInventoryEvents`)과 여기
 *   수동 항목이 같은 유형을 공유하되, 같은 달이 겹치면 수동을 우선한다(source.ts에서 제외).
 * - `other` — 위에 안 맞는 것(가이던스 수정, 발언·검토 단계, 출시 연기 등).
 *
 * ## 읽을 때 주의
 * - `plant`가 "미국 딜러 네트워크"인 항목은 **공장이 아니다**. Cox 집계 딜러 재고일수처럼
 *   판매 채널 지표라 공장 축으로 합산되지 않는다. 생산 이벤트와 섞어 세지 말 것.
 * - `inventoryRelation`은 `response_to_glut | response_to_demand | unrelated` 3값뿐이라
 *   "재고를 관측만 한" 지표성 항목도 `response_to_glut`으로 넣었다(조치가 아니라 관측이다).
 * - 관세·엔진 부족·알루미늄 화재·부품사 분쟁發 중단은 `unrelated`다. 재고 조치와 섞으면
 *   출하 감소의 원인을 잘못 귀속하게 된다.
 */
export const PLANT_EVENTS: PlantEvent[] = [
  {
    plant: 'Brampton Assembly',
    country: 'Canada',
    startYearMonth: 202401,
    endYearMonth: 202502,
    eventType: 'retooling',
    models: ['Jeep Compass', 'Dodge Charger', 'Dodge Challenger', 'Chrysler 300'],
    summary:
      '2023년 말 머슬카(Charger·Challenger·300) 생산 종료 후 2024년 초부터 차세대 Jeep Compass 설비 전환에 들어가면서 조립 조합원 약 3,000명이 휴업 상태가 됐다. 전환 공사 자체는 2024년 내내 진행되다 2025년 2월 전면 중단됐다.',
    statedReason:
      '차세대 Jeep Compass(EV·가솔린) 생산을 위한 설비 전환. 2023년 12월 머슬카 생산 종료 후 조립 조합원은 2024년 초부터 휴업',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://thepointer.com/article/2026-01-08/thousands-of-brampton-stellantis-workers-remain-in-limbo-while-windsor-plant-adds-1k-employees-local-politician-voices-frustration',
    sourceName: 'The Pointer',
    sourceDate: '2026-01-08',
  },
  {
    plant: 'Detroit Assembly Complex - Mack',
    country: 'USA',
    startYearMonth: 202402,
    endYearMonth: 202402,
    eventType: 'shift_cut',
    models: ['Jeep Grand Cherokee', 'Jeep Grand Cherokee L', 'Jeep Grand Cherokee 4xe'],
    summary:
      '재고 조절을 위해 3교대를 2교대로 축소해 WARN 통지 기준 2,455명이 영향권에 들었다(2024-02-05 발효). Tavares는 "딜러 단계에 재고가 너무 많은 것은 좋지 않다"며 당시 미판매 지프 재고를 100일분으로 언급했다.',
    statedReason:
      '지프 재고 과잉(당시 미판매 지프 100일분 재고) + 캘리포니아 배기규제 대응 + UAW 신협약 근무일정 재편',
    inventoryRelation: 'response_to_glut',
    sourceUrl:
      'https://www.wardsauto.com/news/archive-wards-stellantis-reducing-production-at-detroit-toledo-plants/797712/',
    sourceName: 'WardsAuto',
    sourceDate: '2023-12-08',
  },
  {
    plant: 'Toledo Assembly Complex',
    country: 'USA',
    startYearMonth: 202402,
    endYearMonth: 202402,
    eventType: 'shift_cut',
    models: ['Jeep Wrangler', 'Jeep Gladiator'],
    summary:
      '대체근무제(AWS)를 전통적 2교대로 전환해 1,225명이 영향을 받았다(2024-02-05 발효). 회사가 WARN 통지에서 밝힌 공식 사유는 재고 해소가 아니라 캘리포니아 배출가스 규제(CARB) 대응이었고, 교대 전환 자체는 2023년 UAW 단체협상 합의 사항이다.',
    statedReason:
      'WARN 통지상 공식 사유는 캘리포니아 배출가스 규제(CARB / Advanced Clean Cars II) 대응 + 2023년 UAW 단체협상의 근무일정 재편 합의. 당시 지프 재고 과잉(2023년 12월 초 약 128일분)이 배경으로 병존',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.wardsauto.com/news/archive-wards-stellantis-reducing-production-at-detroit-toledo-plants/797712/',
    sourceName: 'WardsAuto',
    sourceDate: '2023-12-08',
  },
  {
    plant: 'Detroit Assembly Complex - Mack',
    country: 'USA',
    startYearMonth: 202404,
    endYearMonth: 202404,
    eventType: 'layoff',
    models: ['Jeep Grand Cherokee', 'Jeep Grand Cherokee L'],
    summary:
      'DAC-Mack에서 비숙련직 57명이 추가 해고됐다(2021년 4월 7일 이전 입사자 대상) — 2월 교대 축소(WARN 최대 2,455명)에 뒤이은 조치다.',
    statedReason: "생산성 개선 목적의 '미국 전역 무기한 해고' 방침",
    inventoryRelation: 'unrelated',
    sourceUrl: 'https://www.wsws.org/en/articles/2024/04/24/fqlq-a24.html',
    sourceName: 'World Socialist Web Site',
    sourceDate: '2024-04-24',
  },
  {
    plant: 'Sterling Heights Assembly Plant',
    country: 'USA',
    startYearMonth: 202404,
    endYearMonth: 202404,
    eventType: 'layoff',
    models: ['Ram 1500'],
    summary:
      '2024년 4월 22일 Ram 1500을 만드는 SHAP에서 199명이 해고됐고, 회사는 추가 감원을 예고했다.',
    statedReason:
      '"제조 설비의 효율을 개선하기 위한 조치를 계속하고 있다"(스텔란티스). UAW는 "사람보다 이익"이라며 비판',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.autonews.com/manufacturing/stellantis-job-cuts-199-workers-lose-jobs-ram-1500-plant/',
    sourceName: 'Automotive News',
    sourceDate: '2024-04-22',
  },
  {
    plant: '북미 전체 (공장 미특정)',
    country: 'USA',
    startYearMonth: 202407,
    endYearMonth: 202412,
    eventType: 'other',
    models: ['Jeep', 'Ram', 'Dodge', 'Chrysler'],
    summary:
      '2024년 실적 가이던스를 하향하면서 하반기 북미 출하를 전년 대비 20만 대 이상 축소하고, 미국 딜러 재고를 2024년 말까지 33만 대 이하로 낮추겠다고 밝혔다(당초 2025년 1분기 목표에서 앞당김). 공장·차종을 특정하지 않은 전사 가이던스 수정이며, 출하는 북미(미국+캐나다+멕시코) 기준이고 33만 대 목표만 미국 딜러 재고 기준이다.',
    statedReason: '딜러 재고 과잉 해소 — 재고 정상화 시점을 2025년 1분기에서 2024년 말로 앞당김',
    inventoryRelation: 'response_to_glut',
    sourceUrl:
      'https://eu.detroitnews.com/story/business/autos/chrysler/2024/09/30/stellantis-lowers-2024-outlook-accelerates-inventory-reductions/75449812007/',
    sourceName: 'The Detroit News',
    sourceDate: '2024-09-30',
  },
  {
    plant: 'Warren Truck Assembly',
    country: 'USA',
    startYearMonth: 202407,
    endYearMonth: 202407,
    eventType: 'shift_cut',
    models: ['Jeep Wagoneer', 'Jeep Grand Wagoneer', 'Ram 1500 Classic'],
    summary:
      '7월 한 달간 1교대로 축소해 시급직 약 3,300명 중 1,600명을 일시 해고했다. 회사 공식 설명은 "생산을 판매에 맞춘 조정"이었고, 2분기 미국 판매 21% 감소와의 연결은 언론 보도다.',
    statedReason:
      '회사 공식 사유는 "생산을 판매에 맞춰 가동 패턴 조정"(align production with sales) + 재고 조정. 2분기 미국 판매 21% 감소와의 인과 연결은 언론 해석',
    inventoryRelation: 'response_to_glut',
    sourceUrl:
      'https://www.autonews.com/manufacturing/stellantis-job-cuts-warren-truck-plant-lays-1600-temporarily/',
    sourceName: 'Automotive News',
    sourceDate: '2024-07-02',
  },
  {
    plant: 'Warren Truck Assembly',
    country: 'USA',
    startYearMonth: 202408,
    endYearMonth: 202408,
    eventType: 'layoff',
    models: ['Ram 1500 Classic'],
    summary:
      'Ram 1500 Classic 생산 종료에 따라 최대 2,450명 무기한 해고를 예고한 WARN 통지가 발행됐다. 실제 집행은 2024년 10월 약 1,100명으로 예고치를 크게 밑돌았다.',
    statedReason: 'Ram 1500 Classic 생산 종료(구형 모델 단종)에 따른 인력 감축',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.detroitnews.com/story/business/autos/chrysler/2024/08/09/layoffs-stellantis-warren-ram-1500-classic-production-ends/74737898007/',
    sourceName: 'The Detroit News',
    sourceDate: '2024-08-09',
  },
  {
    plant: 'Detroit Assembly Complex - Jefferson',
    country: 'USA',
    startYearMonth: 202409,
    endYearMonth: 202410,
    eventType: 'downtime',
    models: ['Jeep Grand Cherokee', 'Jeep Grand Cherokee 4xe', 'Dodge Durango'],
    summary: '재고 축소를 위해 2024년 9월 30일 주간 생산을 중단하고 해당 인력을 일시 해고했다.',
    statedReason: '과다한 차량 재고를 추가로 줄이기 위한 조치',
    inventoryRelation: 'response_to_glut',
    sourceUrl: 'https://www.marklines.com/en/news/315381',
    sourceName: 'MarkLines',
    sourceDate: '2024-10-01',
  },
  {
    plant: 'Sterling Heights Assembly Plant',
    country: 'USA',
    startYearMonth: 202409,
    endYearMonth: 202409,
    eventType: 'retooling',
    models: ['Ram 1500 REV', 'Ram 1500 Ramcharger', 'Ram 1500'],
    summary:
      '2024년 9월 11일 미시간 3개 공장에 4억 600만 달러 이상(SHAP 몫 2억 3,550만 달러) 투자를 발표 — SHAP를 Ram 1500 REV·Ramcharger 생산용으로 개조하되 기존 내연기관 Ram 1500과 혼류 생산한다. 시점은 발표일 기준이며 실제 개조·양산 램프업은 이후다.',
    statedReason: '멀티 에너지 전략 실행 — BEV·주행거리 연장형 전동화 라인 신설',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.manufacturingdive.com/news/stellantis-400M-ev-michigan-plant-investments-ram-1500-jeep/726915/',
    sourceName: 'Manufacturing Dive',
    sourceDate: '2024-09-11',
  },
  {
    plant: 'Toledo Assembly Complex / Detroit Assembly Complex - Mack·Jefferson',
    country: 'USA',
    startYearMonth: 202409,
    endYearMonth: 202409,
    eventType: 'downtime',
    models: ['Jeep Wrangler', 'Jeep Grand Cherokee'],
    summary:
      '재고 과잉으로 Wrangler(Toledo)·Grand Cherokee(Mack + Jefferson North) 생산을 일시 중단했다(Grand Cherokee $5,000 현금 인센티브 병행). 당시 Jeep·Dodge 재고는 4개월분(120일 이상)으로 업계 평균 60~70일의 약 2배였다.',
    statedReason:
      '재고 과잉 — Jeep·Dodge 브랜드가 4개월분(120일 이상) 재고 보유, 업계 평균 60~70일의 약 2배',
    inventoryRelation: 'response_to_glut',
    sourceUrl: 'https://tflcar.com/2024/09/jeep-cut-wrangler-grand-cherokee-production-news/',
    sourceName: 'TFLcar',
    sourceDate: '2024-09-06',
  },
  {
    plant: 'Detroit Assembly Complex - Jefferson',
    country: 'USA',
    startYearMonth: 202410,
    endYearMonth: 202411,
    eventType: 'downtime',
    models: ['Jeep Grand Cherokee', 'Dodge Durango'],
    summary:
      'DAC-Jefferson이 2024년 10월 28일~11월 1일 생산을 중단 — 3372·3440 부서를 제외한 전 인원이 일시 해고 대상.',
    statedReason: "판매 부진과 딜러 재고 과잉 — 수요에 맞춘 '교대조 단위 스케줄링' 방식 도입",
    inventoryRelation: 'response_to_glut',
    sourceUrl:
      'https://gearheaddaily.com/stellantis-announces-temporary-production-halt-at-detroit-assembly-complex',
    sourceName: 'Gearhead Daily',
    sourceDate: '2024-10-28',
  },
  {
    plant: 'Detroit Assembly Complex - Jefferson & Mack',
    country: 'USA',
    startYearMonth: 202410,
    endYearMonth: 202410,
    eventType: 'layoff',
    models: ['Jeep Grand Cherokee', 'Dodge Durango'],
    summary:
      'Mack·Jefferson 생산이 중단되고 각 공장에서 51명씩(합계 102명) 무기한 해고됐다. 같은 주 Toledo는 감산, Warren Truck은 가동 중단, Warren Stamping도 일시 해고 + 최소 생산 상태였다.',
    statedReason:
      '대규모 재고 축소 — 2024년 말까지 미국 딜러 재고를 33만 대 이하로 낮추는 목표(당초 2025년 1분기에서 앞당김), 3분기 미국 판매 20% 감소',
    inventoryRelation: 'response_to_glut',
    sourceUrl:
      'https://www.detroitnews.com/story/business/autos/chrysler/2024/10/29/stellantis-cuts-more-jobs-pauses-production-at-detroit-assembly-complex/75921909007/',
    sourceName: 'The Detroit News',
    sourceDate: '2024-10-29',
  },
  {
    plant: 'Sterling Heights Assembly Plant',
    country: 'USA',
    startYearMonth: 202410,
    endYearMonth: 202410,
    eventType: 'layoff',
    models: ['Ram 1500'],
    summary:
      '계절직 177명이 10월 1일자로 계약 종료되고 정규직 14명이 무기한 해고돼 총 191명이 감원됐다. 정규직 14명의 효력일은 2024-09-28로 엄밀히는 9월분이다.',
    statedReason:
      '"지속되는 극심한 외부 시장 여건" — 계절직은 2023년 UAW 단체협약에 따른 여름 휴가 대체 인력 종료',
    inventoryRelation: 'response_to_glut',
    sourceUrl:
      'https://www.cbsnews.com/detroit/news/stellantis-laying-off-nearly-200-workers-sterling-heights-plant/',
    sourceName: 'CBS Detroit',
    sourceDate: '2024-09-25',
  },
  {
    plant: 'Sterling Heights Assembly Plant',
    country: 'USA',
    startYearMonth: 202410,
    endYearMonth: 202410,
    eventType: 'layoff',
    models: ['Ram 1500'],
    summary:
      '2024년 10월 7일자로 정규직 42명이 추가 무기한 해고돼 SHAP 무기한 해고자가 총 56명으로 늘었다.',
    statedReason: '공장 인원 과잉(overpopulation) — UAW Local 1700 통지문 기준',
    inventoryRelation: 'response_to_glut',
    sourceUrl: 'https://www.candgnews.com/news/stellantis-shap-workers-face-job-losses--6625',
    sourceName: 'C & G Newspapers',
    sourceDate: '2024-10-03',
  },
  {
    plant: 'Toledo South Assembly Plant',
    country: 'USA',
    startYearMonth: 202411,
    endYearMonth: 202411,
    eventType: 'shift_cut',
    models: ['Jeep Gladiator'],
    summary:
      'Gladiator 3분기 판매 35% 급감에 대응해 2교대를 1교대로 줄이고 1,139명(South Gladiator 라인 500명 + North Wrangler 라인 639명)을 2025-01-05부터 무기한 해고한다고 발표했다. 이 조치는 2024년 12월 WARN 통지 연장으로 시행되지 않았다.',
    statedReason:
      '"판매에 맞춰 생산을 관리해 높은 재고 수준을 줄이기 위한 불가피한 조치" — Gladiator 3분기 판매 전년 대비 35% 감소',
    inventoryRelation: 'response_to_glut',
    sourceUrl:
      'https://www.detroitnews.com/story/business/autos/chrysler/2024/11/06/stellantis-will-cut-1100-jobs-at-toledos-jeep-gladiator-plant/76094780007/',
    sourceName: 'The Detroit News',
    sourceDate: '2024-11-06',
  },
  {
    plant: '미국 딜러 네트워크 (공장 아님 — 판매 채널 재고 지표)',
    country: 'USA',
    startYearMonth: 202412,
    endYearMonth: 202412,
    eventType: 'inventory',
    models: ['Jeep', 'Ram', 'Dodge', 'Chrysler'],
    summary:
      '2024-12-31 기준 미국 딜러 재고가 전년 대비 20% 감소한 30.4만 대로 떨어져, 2024년 9월에 제시한 "연말까지 33만 대 이하" 재고 정상화 목표를 초과 달성했다.',
    statedReason:
      '재고 정상화 목표 초과 달성 — 하반기 북미 출하 20만 대 이상 축소, 구형 모델 인센티브 확대, 생산성 개선의 결과',
    inventoryRelation: 'response_to_glut',
    sourceUrl:
      'https://www.stellantis.com/en/news/press-releases/2025/february/full-year-2024-results',
    sourceName: 'Stellantis (Full Year 2024 Results)',
    sourceDate: '2025-02-26',
  },
  {
    plant: 'Toledo South Assembly Plant',
    country: 'USA',
    startYearMonth: 202412,
    endYearMonth: 202501,
    eventType: 'restart',
    models: ['Jeep Gladiator'],
    summary:
      'Tavares 사임 약 3주 뒤 11월 WARN 통지가 연장돼 2025-01-05 예정이던 1,139명 무기한 해고가 시행되지 않았다(0명). 취소가 아닌 연기·보류이며 무기한 해고 규모는 125명으로 축소됐다.',
    statedReason: 'Carlos Tavares CEO 사임(2024-12-01) 직후 북미 전략 재검토 — WARN 통지 연장',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.carscoops.com/2024/12/stellantis-backtracks-on-1100-us-layoffs-now-ceo-tavares-has-gone/',
    sourceName: 'Carscoops',
    sourceDate: '2024-12-24',
  },
  {
    plant: '미국 딜러 네트워크 (공장 아님 — Cox 집계 브랜드별 딜러 재고일수)',
    country: 'USA',
    startYearMonth: 202501,
    endYearMonth: 202501,
    eventType: 'inventory',
    models: ['Dodge', 'Jeep', 'Ram', 'Chrysler'],
    summary:
      '2025-01-06 기준 재고일수는 Dodge 122일·Jeep 114일·Ram 107일·Chrysler 79일로 2024년 말 대비 개선됐으나, 12월 업계 평균 75일을 여전히 크게 웃돌았다. Ram은 다른 3개 브랜드와 달리 전년비 개선이 사실상 없었다.',
    statedReason: '2024년 하반기 생산 감축·인센티브 확대 효과로 재고 10만 대 이상 감축',
    inventoryRelation: 'response_to_glut',
    sourceUrl:
      'https://www.carscoops.com/2025/01/stellantis-starting-to-get-its-us-inventory-under-control/',
    sourceName: 'Carscoops',
    sourceDate: '2025-01-22',
  },
  {
    plant: 'Brampton Assembly',
    country: 'Canada',
    startYearMonth: 202502,
    endYearMonth: 202502,
    eventType: 'downtime',
    models: ['Jeep Compass'],
    summary:
      "2025년 2월 20일 스텔란티스가 Brampton의 Jeep Compass 설비 전환 작업을 돌연 중단한다고 통보했고, Unifor는 '심각한 우려'를 표명했다.",
    statedReason: "관세 위협·EV 정책 변화 속 제품 전략 재검토 → 설비 전환 작업 '일시 중단'",
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.bnnbloomberg.ca/business/company-news/2025/02/20/unifor-has-grave-concern-over-stellantis-work-halt-in-brampton-ont/',
    sourceName: 'BNN Bloomberg',
    sourceDate: '2025-02-20',
  },
  {
    plant: 'Brampton Assembly',
    country: 'Canada',
    startYearMonth: 202504,
    endYearMonth: 202504,
    eventType: 'downtime',
    models: ['Jeep Compass'],
    summary:
      '설비 전환 중단 2개월이 지난 2025년 4월에도 공장은 여전히 idle 상태였고, 현장에 남은 숙련직은 기존 400명에서 약 20명 수준으로 축소됐다.',
    statedReason: '설비 전환 중단 지속, 재개 시점 미제시',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.autonews.com/stellantis/anc-brampton-assembly-plant-still-down-stellantis-0425/',
    sourceName: 'Automotive News',
    sourceDate: '2025-04-25',
  },
  {
    plant: 'Detroit Assembly Complex - Jefferson & Mack',
    country: 'USA',
    startYearMonth: 202504,
    endYearMonth: 202505,
    eventType: 'downtime',
    models: ['Jeep Grand Cherokee', 'Dodge Durango'],
    summary:
      'Mack·Jefferson North가 2025년 4월 28일 주간에 Grand Cherokee·Durango 생산을 동반 중단하고, Mack은 5월 19일 주간에 한 주 더 중단했다. 2026년형 Grand Cherokee 전환 명목이나 판매 부진·관세 감산과 시점이 겹친다.',
    statedReason:
      '표면적으로는 2026년형 Grand Cherokee 전환 준비("성공적 런칭과 최고 품질 확보를 위해 2025년형 생산을 연장"). 실제로는 1분기 미국 판매 12% 감소(Grand Cherokee -11%, Durango -9%)와 4월 발효된 25% 수입차 관세에 따른 감산 국면과 겹침',
    inventoryRelation: 'response_to_glut',
    sourceUrl:
      'https://www.detroitnews.com/story/business/autos/chrysler/2025/04/21/stellantis-to-pause-production-at-detroit-plants-that-make-grand-cherokee/83197990007/',
    sourceName: 'The Detroit News',
    sourceDate: '2025-04-21',
  },
  {
    plant: 'Toluca Assembly Plant',
    country: 'Mexico',
    startYearMonth: 202504,
    endYearMonth: 202505,
    eventType: 'downtime',
    models: ['Jeep Compass', 'Jeep Wagoneer S'],
    summary:
      '관세 대응으로 4월 4일~5월 4일 한 달간 차량 생산을 전면 중단했다. 다만 톨루카 직원(약 2,400명)은 해고되지 않고 계속 출근해 유지보수 업무를 하며 급여를 전액 수령했고, 동반된 900명 일시 해고는 미국 지원 공장(미시간·인디애나)에 한정된다.',
    statedReason:
      '트럼프 행정부 25% 자동차 관세 발효에 따른 불확실성 평가 + Wagoneer S 판매 부진. 멕시코 현지 해고는 없었으나 미시간·인디애나 부품 공장에서 900명 일시 해고 발생',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.clickondetroit.com/business/2025/04/04/us-tariffs-ripple-through-auto-supply-chains-into-mexico/',
    sourceName: 'Associated Press (ClickOnDetroit 게재)',
    sourceDate: '2025-04-04',
  },
  {
    plant: 'Saltillo Truck Assembly Plant',
    country: 'Mexico',
    startYearMonth: 202504,
    endYearMonth: 202504,
    eventType: 'other',
    models: ['Ram 1500', 'Ram 2500', 'Ram 3500'],
    summary:
      '2025년 4월 30일 애널리스트 컨퍼런스콜에서 CFO Doug Ostermann이 멕시코에서 만드는 Ram 픽업 일부를 미국으로 이전할 수 있다고 언급했다 — 실행이 아닌 검토 단계이며, 그가 "Saltillo"를 직접 지명한 근거는 없다(멕시코 내 Ram 픽업 생산지가 Saltillo라 귀속한 추론).',
    statedReason:
      '관세 회피 — USMCA 역내 부품 비중을 현재 80%에서 85%로 올리면 미국 생산차가 1년차 무관세 가능',
    inventoryRelation: 'unrelated',
    sourceUrl: 'https://carbuzz.com/stellantis-moving-pickup-truck-production-mexico-us/',
    sourceName: 'CarBuzz',
    sourceDate: '2025-05-04',
  },
  {
    plant: 'Sterling Heights Assembly Plant',
    country: 'USA',
    startYearMonth: 202504,
    endYearMonth: 202505,
    eventType: 'other',
    models: ['Ram 1500'],
    summary:
      '3.0L Hurricane 직6 엔진 부족으로 Warren Truck이 4월 14일부터 5월 초까지 중단된 반면, 스텔란티스는 가용 엔진 전량을 SHAP의 Ram 1500 생산 유지에 배분했다. 증산이 아니라 방어적 유지이며 북미 전체 생산은 오히려 감소했다.',
    statedReason:
      '3.0L 트윈터보 HURRICANE 직6 엔진 사내 공급 부족 — 가용 물량 전량을 SHAP의 Ram 1500에 우선 배분 (관세와 무관하다고 명시)',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.detroitnews.com/story/business/autos/chrysler/2025/04/03/warren-truck-suv-production-will-pause-for-weeks-stellantis-says/82796381007/',
    sourceName: 'The Detroit News',
    sourceDate: '2025-04-03',
  },
  {
    plant: 'Warren Truck Assembly',
    country: 'USA',
    startYearMonth: 202504,
    endYearMonth: 202505,
    eventType: 'downtime',
    models: ['Jeep Wagoneer', 'Jeep Grand Wagoneer'],
    summary:
      '재고 사유가 아닌 3.0L Hurricane 엔진 공급 부족으로 2025-04-14부터 수 주간 생산을 중단했다. 5월 초 잠시 재가동됐으나 같은 엔진 부족으로 5/19 재차 중단됐다가 5/26 재개돼, 제약은 4~5월에 걸쳐 반복됐다.',
    statedReason:
      '재고 과잉이 아닌 엔진 부족 — 가용 물량 전량을 Sterling Heights의 Ram 1500 생산에 우선 배정',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.detroitnews.com/story/business/autos/chrysler/2025/04/03/warren-truck-suv-production-will-pause-for-weeks-stellantis-says/82796381007/',
    sourceName: 'The Detroit News',
    sourceDate: '2025-04-03',
  },
  {
    plant: 'Windsor Assembly',
    country: 'Canada',
    startYearMonth: 202504,
    endYearMonth: 202504,
    eventType: 'downtime',
    models: [
      'Chrysler Pacifica',
      'Chrysler Grand Caravan',
      'Chrysler Voyager',
      'Dodge Charger Daytona',
    ],
    summary:
      '2025년 4월 7일부터 2주간 관세 대응으로 가동을 중단했다(4월 22일 복귀 — 4/21이 Easter Monday 공휴일). 조합원 4,500명 규모 공장에서 직접 영향 인원은 3,000~3,500명이며, 함께 발표된 미국 5개 스탬핑·파워트레인(주조 포함) 공장 900명 일시 해고는 멕시코 톨루카 중단과도 연동된 조치다.',
    statedReason: '트럼프 행정부의 25% 자동차 관세(2025-04-03 발효) 대응',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.unifor.org/news/all-news/stellantis-responds-trump-auto-tariff-canadian-mexican-and-us-layoffs',
    sourceName: 'Unifor',
    sourceDate: '2025-04-03',
  },
  {
    plant: 'Sterling Heights Assembly Plant',
    country: 'USA',
    startYearMonth: 202505,
    endYearMonth: 202505,
    eventType: 'other',
    models: ['Ram 1500 REV', 'Ram 1500 Ramcharger'],
    summary:
      'SHAP의 전동화 신차 출시가 재차 연기 — Ramcharger(주행거리 연장형)는 2026년 초로, Ram 1500 REV(순수 전기)는 2027년으로 밀렸다(당초 각각 2024년 말 계획).',
    statedReason:
      '전기 픽업 수요 부진 — "품질 검증 기간을 연장해 최고 품질의 생산을 보장하기 위함"',
    inventoryRelation: 'unrelated',
    sourceUrl: 'https://www.cbtnews.com/stellantis-delays-ram-ev-launches-to-2026-and-2027/',
    sourceName: 'CBT News',
    sourceDate: '2025-05-16',
  },
  {
    plant: 'Windsor Assembly',
    country: 'Canada',
    startYearMonth: 202505,
    endYearMonth: 202505,
    eventType: 'downtime',
    models: [
      'Chrysler Pacifica',
      'Chrysler Grand Caravan',
      'Chrysler Voyager',
      'Dodge Charger Daytona',
    ],
    summary:
      '2025년 5월 5일 주간 Windsor Assembly가 1주간 추가 가동 중단돼 약 3,800명이 일시 해고됐다(4월 2주 중단에 이은 연속 셧다운).',
    statedReason: "회사 공식 사유는 '2026년형 모델 전환'이나, 노조는 관세 영향으로 판단",
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://windsornewstoday.ca/windsor/news/2025/05/01/another-shutdown-at-windsor-assembly-plant',
    sourceName: 'Windsor News Today',
    sourceDate: '2025-05-01',
  },
  {
    plant: 'Windsor Assembly',
    country: 'Canada',
    startYearMonth: 202505,
    endYearMonth: 202505,
    eventType: 'shift_cut',
    models: ['Chrysler Pacifica', 'Dodge Charger Daytona'],
    summary:
      '2025년 5월 6일 잠정 작업 스케줄을 공개하면서 Windsor 3교대 증설을 2026년으로 연기한다고 발표했다(2026년 내 구체적 분기는 미제시). 당초 2025년 2월 예정이던 것이 2025년 하반기로 1차, 2026년으로 2차 연기된 것이다.',
    statedReason: '관세 불확실성 — 시장 여건 명확해질 때까지 3교대 증설 보류',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://windsornewstoday.ca/windsor/news/2025/05/06/stellantis-releases-tentative-work-schedule-announces-third-shift-postponed',
    sourceName: 'Windsor News Today',
    sourceDate: '2025-05-06',
  },
  {
    plant: 'Windsor Assembly',
    country: 'Canada',
    startYearMonth: 202505,
    endYearMonth: 202506,
    eventType: 'shift_cut',
    models: ['Chrysler Pacifica', 'Chrysler Voyager', 'Dodge Charger Daytona'],
    summary:
      '2025-05-06 Unifor Local 444에 통보된 변동 스케줄로 5~6월을 운영했다 — 5/12·5/19 전면 가동, 5/26·6/9 1교대만, 6/2·6/16 2교대만(잠정). 이후 계획이 상향돼 6/23 주부터 2교대 전면 가동으로 조기 복귀했다.',
    statedReason:
      '관세發 업계 불확실성 + 2025년형 마감·2026년형(Pacifica·Voyager/Grand Caravan·Charger) 전환 준비',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://windsornewstoday.ca/windsor/news/2025/05/06/stellantis-releases-tentative-work-schedule-announces-third-shift-postponed',
    sourceName: 'Windsor News Today',
    sourceDate: '2025-05-06',
  },
  {
    plant: 'Windsor Assembly',
    country: 'Canada',
    startYearMonth: 202505,
    endYearMonth: 202505,
    eventType: 'other',
    models: ['Dodge Charger Daytona R/T'],
    summary:
      '2025년 5월 22일 Windsor에서 생산할 Dodge Charger Daytona R/T(엔트리 전기 모델)의 2026년형 생산을 연기한다고 발표했다 — 재개 시점은 제시하지 않았고 Scat Pack·4도어·Sixpack은 계속 생산한다.',
    statedReason:
      '미국 관세 정책 영향 평가 — 다만 후속 보도는 R/T 판매 부진·EV 수요 약세를 실질 배경으로 지목',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://windsornewstoday.ca/windsor/news/2025/05/22/production-on-2026-dodge-charger-daytona-rt-paused',
    sourceName: 'Windsor News Today',
    sourceDate: '2025-05-22',
  },
  {
    plant: 'Windsor Assembly',
    country: 'Canada',
    startYearMonth: 202506,
    endYearMonth: 202506,
    eventType: 'restart',
    models: ['Chrysler Pacifica', 'Chrysler Voyager', 'Dodge Charger'],
    summary:
      '2025년 6월 23일 주부터 순환 감축을 끝내고 양 교대 전면 가동으로 복귀했다(당초 예상보다 1주 빠름). 8월 18·25일 2주 하계 셧다운 전까지 유지된 것으로 보이나, 6월 시점 보도는 지속 기간을 "불명"으로 전했다.',
    statedReason: '2025년형 마감 물량 + 2026년형 라인업 준비',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://moparinsiders.com/stellantis-restores-full-production-at-windsor-assembly-starting-june-23/',
    sourceName: 'MoparInsiders',
    sourceDate: '2025-06-16',
  },
  {
    plant: 'Windsor Assembly',
    country: 'Canada',
    startYearMonth: 202508,
    endYearMonth: 202508,
    eventType: 'downtime',
    models: ['Chrysler Pacifica', 'Dodge Charger'],
    summary: '2025년 8월 18일·25일 2주간 Windsor Assembly가 통상적인 하계 셧다운에 들어갔다.',
    statedReason: '관례적 하계 셧다운(2주)',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://moparinsiders.com/stellantis-restores-full-production-at-windsor-assembly-starting-june-23/',
    sourceName: 'MoparInsiders',
    sourceDate: '2025-06-16',
  },
  {
    plant: 'Windsor Assembly',
    country: 'Canada',
    startYearMonth: 202508,
    endYearMonth: 202508,
    eventType: 'layoff',
    models: ['Dodge Charger Daytona'],
    summary:
      '2025년 8월 15일 Windsor Assembly에서 근속 하위 인원 약 100명에게 해고를 통보했다. 회사 공식 설명은 "통상적인 물량 조정"이었고, 전기 Dodge Charger 축소와의 연결은 CBC 보도 프레이밍과 현장 근로자 증언에 근거한 해석이다.',
    statedReason:
      "회사 공식 설명은 '근속 기준의 통상적 물량 조정(regular volume adjustments)'. 전기 Charger 축소와의 연결은 CBC 보도·근로자 증언에 근거",
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.cbc.ca/news/canada/windsor/stellantis-layoffs-ev-charger-windsor-assembly-workers-dodge-1.7610072',
    sourceName: 'CBC News',
    sourceDate: '2025-08-15',
  },
  {
    plant: 'Windsor Assembly',
    country: 'Canada',
    startYearMonth: 202509,
    endYearMonth: 202509,
    eventType: 'shift_add',
    models: ['Chrysler Pacifica', 'Chrysler Grand Caravan', 'Dodge Charger'],
    summary:
      '2025년 9월 9일 Windsor Assembly의 3교대를 2026년 초 복원해 최대 1,000명을 재고용하겠다고 발표했다(2020년 3교대 폐지 이후 첫 복원). "최대 1,000명"은 발표 시점 추정치이며 실제 2026-02-17 가동 시에는 1,700명 이상이 신규 채용됐다.',
    statedReason: "해당 공장 생산 차종의 '수요 증가' 예상",
    inventoryRelation: 'response_to_demand',
    sourceUrl: 'https://www.cbc.ca/news/canada/windsor/windsor-stellantis-third-shift-1.7629256',
    sourceName: 'CBC News',
    sourceDate: '2025-09-09',
  },
  {
    plant: 'Brampton Assembly',
    country: 'Canada',
    startYearMonth: 202510,
    endYearMonth: 202510,
    eventType: 'other',
    models: ['Jeep Compass'],
    summary:
      '2025년 10월 14일 스텔란티스가 Brampton에 배정했던 차세대 Jeep Compass 생산을 미국 일리노이 Belvidere로 이관한다고 발표했다(130억 달러 미국 투자의 일부). 이미 2023년 말 생산 종료·2025년 2월 설비 전환 중단으로 약 2년째 유휴였던 Brampton은 이로써 확정된 후속 차종을 잃었다.',
    statedReason:
      '미국 관세 대응 차원의 130억 달러 미국 투자 계획 — Compass·Cherokee 생산을 일리노이 Belvidere로 이관(6억 달러 초과 투자, 2027년 양산 목표)',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.cp24.com/local/peel/2025/10/15/stellantis-moving-jeep-compass-production-originally-slated-for-brampton-plant-to-illinois/',
    sourceName: 'CP24',
    sourceDate: '2025-10-15',
  },
  {
    plant: 'Detroit Assembly Complex - Jefferson',
    country: 'USA',
    startYearMonth: 202510,
    endYearMonth: 202510,
    eventType: 'retooling',
    models: ['Dodge Durango'],
    summary:
      '2025년 10월 14일 DAC-Jefferson에 약 1억 3,000만 달러를 투자해 차세대 Dodge Durango 생산을 준비한다고 발표했다(2029년 양산 목표). 2025년 1월 약속의 재확인이며, 시점은 발표 기준으로 실제 공사·양산은 이후다.',
    statedReason:
      '미국 내 생산 유지 및 차세대 모델 준비 — 총 130억 달러 미국 투자(창사 100년 최대)의 일부',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.stellantis.com/en/news/press-releases/2025/october/stellantis-to-invest-13-billion-to-grow-in-the-united-states',
    sourceName: 'Stellantis (공식 보도자료)',
    sourceDate: '2025-10-14',
  },
  {
    plant: 'Warren Truck Assembly',
    country: 'USA',
    startYearMonth: 202510,
    endYearMonth: 202511,
    eventType: 'downtime',
    models: ['Jeep Wagoneer', 'Jeep Grand Wagoneer'],
    summary:
      'Novelis 화재로 인한 알루미늄 부족으로 2025-10-13 주간부터 최소 3주간 생산을 중단했다(재고 조치와 무관한 공급 차질).',
    statedReason: '재고 과잉이 아닌 알루미늄 공급 차질 — Novelis Oswego 공장 2025-09-16 화재',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.detroitnews.com/story/business/autos/chrysler/2025/10/16/production-paused-at-warren-truck-site-after-fire-at-aluminum-supplier/86731852007/',
    sourceName: 'The Detroit News',
    sourceDate: '2025-10-16',
  },
  {
    plant: '미국 딜러 네트워크 (공장 아님 — Cox 집계 브랜드별 딜러 재고일수)',
    country: 'USA',
    startYearMonth: 202512,
    endYearMonth: 202512,
    eventType: 'inventory',
    models: ['Jeep', 'Ram', 'Chrysler', 'Dodge'],
    summary:
      '2025년 말 기준 Jeep 약 130일·Ram 약 115일로 업계 평균 76일(총 277만 대)을 크게 상회했다. 다만 업계 전체 재고일수는 92일→76일로 급감하는 국면이었으므로 과잉은 스텔란티스 브랜드에 국한된 현상이며, Chrysler는 Cox 제외 기준상 "152일 초과"라는 하한만 도출 가능하다.',
    statedReason: '스텔란티스 브랜드 재고 재증가 — 2025년 초 개선분이 연말로 갈수록 되돌려짐',
    inventoryRelation: 'response_to_glut',
    sourceUrl: 'https://www.carscoops.com/2026/01/toyota-fast-sellers-jeep-lot-glut-2025/',
    sourceName: 'Carscoops',
    sourceDate: '2026-01-18',
  },
  {
    plant: 'Brampton Assembly',
    country: 'Canada',
    startYearMonth: 202512,
    endYearMonth: 202512,
    eventType: 'other',
    models: [],
    summary:
      '2025년 12월 Brampton 직원 약 240명("nearly 240")이 Windsor Assembly로의 전출 기회를 자발적으로 수락했고, 잔여 시급직은 급여의 70%와 건강보험을 받으며 복귀를 대기 중이다.',
    statedReason: 'Brampton 무기한 휴업 지속에 따른 인력 재배치(Windsor 3교대 증설과 연계)',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://thepointer.com/article/2026-03-12/stellantis-repeats-commitment-to-reopening-brampton-plant-then-lays-off-20-staff',
    sourceName: 'The Pointer',
    sourceDate: '2026-03-12',
  },
  {
    plant: 'Brampton Assembly',
    country: 'Canada',
    startYearMonth: 202512,
    endYearMonth: 202512,
    eventType: 'other',
    models: ['Jeep Compass'],
    summary:
      "2025년 12월 캐나다 산업부 장관 Mélanie Joly가 스텔란티스에 연방 지원계약 채무불이행(notice of default) 통보를 예고했고, 회사는 '계약 위반이 아니며 공장은 운영 일시정지 상태'라고 반박했다.",
    statedReason:
      'Compass 미국 이관이 Brampton 고용 보장 조항을 위반했다는 연방정부 판단(누적 공적자금 5억 달러 이상)',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.cbc.ca/news/canada/windsor/canada-stellantis-sue-brampton-jobs-default-contracts-joly-9.7003596',
    sourceName: 'CBC News',
    sourceDate: null,
  },
  {
    plant: 'Windsor Assembly',
    country: 'Canada',
    startYearMonth: 202512,
    endYearMonth: 202512,
    eventType: 'other',
    models: ['Chrysler Pacifica', 'Dodge Charger'],
    summary:
      '2025년 12월 15일 스텔란티스가 Windsor Assembly 3교대용 신규 채용이 1,000명을 넘어섰다고 발표했다(Brampton 전출 약 240명은 이와 별개 인원).',
    statedReason: '3교대 가동 대비 채용',
    inventoryRelation: 'response_to_demand',
    sourceUrl:
      'https://www.cbc.ca/news/canada/windsor/stellantis-surpasses-1000-third-shift-hires-9.7016442',
    sourceName: 'CBC News',
    sourceDate: '2025-12-15',
  },
  {
    plant: 'Belvidere Assembly Plant',
    country: 'USA',
    startYearMonth: 202601,
    endYearMonth: 202806,
    eventType: 'retooling',
    models: ['Jeep Cherokee', 'Jeep Compass'],
    summary:
      '2025년 10월 130억 달러 미국 투자 프로그램(Belvidere 몫은 6억 달러 이상)의 일부로 2027년 재가동이 재확인됐으나, UAW는 생산 개시가 약 7개월 밀려 2028년 6월이 된다고 주장했다. 스텔란티스는 "plan of record 변경 없음"이라며 2027년 목표 유지를 공식 반박해 일정이 엇갈린다(2023년 초부터 가동 중단 상태).',
    statedReason:
      '설비전환 일정 지연 — 재고 사유 아님. UAW Local 1268 주장이며 회사는 공식 부인. 2027년 재가동 자체는 2025년 1월에 최초 발표된 것',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.detroitnews.com/story/business/autos/chrysler/2026/01/28/stellantis-set-to-delay-belvidere-plant-reopening-uaw-official-says/88395995007/',
    sourceName: 'The Detroit News',
    sourceDate: '2026-01-28',
  },
  {
    plant: 'Kokomo 사업장 (복수 — 보도자료상 공장 미특정)',
    country: 'USA',
    startYearMonth: 202601,
    endYearMonth: 202612,
    eventType: 'production_add',
    models: ['GMET4 EVO 4기통 엔진'],
    summary:
      '2026년부터 인디애나 코코모 사업장에서 신형 4기통 GMET4 EVO 엔진 생산을 개시하며, 1억 달러 이상 투자·100명 이상 신규 고용이 예정됐다. 보도자료는 특정 엔진 공장이 아니라 "여러 코코모 사업장"이라고만 밝혔고, 2025년 1월 발표의 재확인이다.',
    statedReason:
      '130억 달러 미국 투자(4년, 창사 100년 최대 규모)의 일환. 전략 파워트레인의 생산 거점을 미국으로 확보(관세·USMCA 역내 부품 비중 대응 성격). 전체 계획은 5개 신차 투입, 5,000명 이상 증원',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.stellantis.com/en/news/press-releases/2025/october/stellantis-to-invest-13-billion-to-grow-in-the-united-states',
    sourceName: 'Stellantis (보도자료)',
    sourceDate: '2025-10-14',
  },
  {
    plant: 'Brampton Assembly',
    country: 'Canada',
    startYearMonth: 202602,
    endYearMonth: 202602,
    eventType: 'downtime',
    models: [],
    summary:
      '설비 전환 중단 1년이 지난 2026년 2월에도 Brampton은 배정 차종 없이 제자리걸음이며 재가동 일정이 여전히 없다.',
    statedReason: '제품 배정(product commitment) 부재로 공장 장래 불투명',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.autonews.com/stellantis/anc-stellantis-brampton-no-progress-retooling-0220/',
    sourceName: 'Automotive News',
    sourceDate: '2026-02-22',
  },
  {
    plant: 'Windsor Assembly',
    country: 'Canada',
    startYearMonth: 202602,
    endYearMonth: 202602,
    eventType: 'shift_add',
    models: [
      'Chrysler Pacifica',
      'Chrysler Voyager',
      'Chrysler Grand Caravan',
      'Dodge Charger',
      'Dodge Charger Daytona',
    ],
    summary:
      '2026년 2월 17일 Windsor Assembly가 6년 만에 3교대를 복원해 신규 1,700여 명을 투입, 총 인력 약 6,000명으로 확대하며 Charger·미니밴 증산에 들어갔다.',
    statedReason:
      '2023년 단체협약 약속 이행 + 신형 Dodge Charger 라인업·미니밴 증산. 2020년 7월 폐지됐던 3교대를 복원(2025년 5월 관세·EV 수요 부진으로 한 차례 연기됐다가 2025년 9월 재확정)',
    inventoryRelation: 'response_to_demand',
    sourceUrl: 'https://www.cbc.ca/news/canada/windsor/stellantis-third-shift-redux-9.7093916',
    sourceName: 'CBC News',
    sourceDate: '2026-02-17',
  },
  {
    plant: '미국 딜러 네트워크 (공장 아님 — Cox 집계 브랜드별 딜러 재고일수)',
    country: 'USA',
    startYearMonth: 202603,
    endYearMonth: 202603,
    eventType: 'inventory',
    models: ['Chrysler', 'Dodge', 'Ram', 'Jeep'],
    summary:
      '2026년 3월 말 재고일수는 Dodge 140일·Ram 138일·Jeep 127일로 업계 평균 79일을 크게 상회했다(총 재고 289만 대). Chrysler는 업계 평균의 2배인 158일을 초과해 Cox가 차트에서 제외 — 158은 제외 임계치일 뿐 Chrysler의 실제 수치는 미공개다.',
    statedReason: '수요 대비 재고 증가 — Chrysler는 Pacifica·Voyager 위주의 노후 라인업이 원인',
    inventoryRelation: 'response_to_glut',
    sourceUrl: 'https://www.carscoops.com/2026/04/us-auto-inventory-march/',
    sourceName: 'Carscoops',
    sourceDate: '2026-04-20',
  },
  {
    plant: 'Belvidere Assembly Plant',
    country: 'USA',
    startYearMonth: 202603,
    endYearMonth: 202603,
    eventType: 'retooling',
    models: ['Jeep Compass', 'Jeep Cherokee'],
    summary:
      'UAW Local 1268이 벨비디어 설비 상태 진단과 철거된 변전소 2기 교체에 1,000만 달러가 승인됐다고 밝혔으나, 확정된 생산 개시일은 여전히 미정이라고 전했다.',
    statedReason:
      '재가동 준비 착수. 다만 본격 리툴링·개조 공사는 아직 미착공이며 HR 인력 채용 등 "작은 진전"만 있는 상태',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.wifr.com/2026/03/30/uaw-1268-shares-update-plans-belvidere-stellantis-plant/',
    sourceName: 'WIFR (Rockford)',
    sourceDate: '2026-03-30',
  },
  {
    plant: 'Brampton Assembly',
    country: 'Canada',
    startYearMonth: 202603,
    endYearMonth: 202603,
    eventType: 'layoff',
    models: [],
    summary:
      '2026년 3월 6일 스텔란티스가 유휴 상태인 Brampton의 무노조 사무직 약 20명을 55주간 해고한다고 통보했다(기존 휴업 중인 조합원 약 3,000명과는 별개).',
    statedReason: '공장 유휴 상태 장기화',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://thepointer.com/article/2026-03-12/stellantis-repeats-commitment-to-reopening-brampton-plant-then-lays-off-20-staff',
    sourceName: 'The Pointer',
    sourceDate: '2026-03-12',
  },
  {
    plant: 'Toluca Assembly Plant',
    country: 'Mexico',
    startYearMonth: 202603,
    endYearMonth: 202605,
    eventType: 'downtime',
    models: ['Jeep Compass', 'Jeep Cherokee', 'Jeep Cherokee Hybrid'],
    summary:
      '툴루카 공장이 ZF Foxconn Chassis Modules의 서스펜션 모듈 납품 중단으로 2026년 3월 14일부터 가동을 멈춰 Jeep Compass·Cherokee 생산이 중단됐다(약 2,500명 영향). 3월 25일 미시간 법원 TRO는 윈저 공장 납품만 대상이었고, 툴루카는 별도 멕시코 법원 명령과 4월 6일 심리를 거쳐 2026년 5월 초에야 생산을 재개했다(약 7주 중단).',
    statedReason:
      '부품사 ZF Foxconn Chassis Modules와의 서스펜션 모듈 단가 분쟁. 스텔란티스는 이미 2,600만 달러 지급 및 2025년 12월 단가 인상 합의했으나 ZF가 추가 7,000만 달러를 요구하며 납품 중단 → 미시간 법원 제소',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://mexicobusiness.news/automotive/news/stellantis-zf-dispute-stops-jeep-production-toluca',
    sourceName: 'Mexico Business News',
    sourceDate: '2026-03-30',
  },
  {
    plant: 'Brampton Assembly',
    country: 'Canada',
    startYearMonth: 202604,
    endYearMonth: 202604,
    eventType: 'other',
    models: ['Leapmotor (차종 미정)'],
    summary:
      '2026년 4월 스텔란티스가 유휴 Brampton에서 중국 Leapmotor 전기차를 완전 분해 키트(CKD)로 조립하는 방안을 초기 논의 중이라는 보도가 나왔다. 전 부품을 중국에서 들여와 캐나다 부품망이 배제되고 복귀 인원도 200~300명에 그친다는 이유로 Unifor·연방정부(Joly 산업장관)·온타리오 주정부가 공동 거부했다.',
    statedReason:
      '중국산 완전 분해(CKD) 키트 조립 방안 — 멕시코·브라질 모델 준용. 2026년 1월 캐나다의 중국산 EV 관세 인하(100% → 6.1%)가 배경이며, 스텔란티스는 2023년 립모터 지분 20%(약 16억 달러) 보유',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://electrek.co/2026/04/02/stellantis-leapmotor-chinese-evs-brampton-canada-plant/',
    sourceName: 'Electrek',
    sourceDate: '2026-04-02',
  },
  {
    plant: 'Brampton Assembly',
    country: 'Canada',
    startYearMonth: 202605,
    endYearMonth: 202605,
    eventType: 'other',
    models: [],
    summary:
      "2026년 5월 28일 스텔란티스 캐나다 CEO Trevor Longley가 Brampton의 지속가능한 해법에 '가까워지고 있다'고 밝혔으나 구체적 차종·일정은 제시하지 않았다.",
    statedReason:
      '지속가능한 해법 모색 — 연방정부·Unifor와 협의 진행. 2025년 10월 Jeep Compass 미국 이관 이후 약 3,000명이 생산 배정 없이 대기(잔류 시급직은 급여 70% + 의료보험 수령)',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.autonews.com/manufacturing/automakers/anc-stellantis-brampton-latest-longley-windsor-plant/',
    sourceName: 'Automotive News',
    sourceDate: '2026-05-28',
  },
  {
    plant: 'Sterling Heights Assembly Plant',
    country: 'USA',
    startYearMonth: 202605,
    endYearMonth: 202607,
    eventType: 'other',
    models: ['Ram 1500'],
    summary:
      '5.7L HEMI V8 부활 이후 Ram 1500 수요가 늘면서 SHAP 6,000명이 수 주간 주 7일 강제 잔업 체제로 가동됐다 — 신규 증설이 아니라 2023년 UAW 전국계약상 의무 잔업이며, 이 부분은 WSWS 단독 보도라 교차 확인이 없다. 숙련직 외주화를 둘러싼 UAW Local 1700 파업 찬반투표는 5월 7일 사측이 노조 입찰 허용에 합의하며 철회됐다.',
    statedReason:
      '5.7L HEMI V8 부활 이후 Ram 1500 수요 급증 — 2025년 실적 부진에서의 이익 회복 추진. 2023년 UAW 전국계약 조항에 따른 의무 잔업(신규 생산능력 추가는 아님)',
    inventoryRelation: 'response_to_demand',
    sourceUrl: 'https://www.wsws.org/en/articles/2026/05/13/gvzm-m13.html',
    sourceName: 'World Socialist Web Site',
    sourceDate: '2026-05-12',
  },
  {
    plant: '미국 딜러 네트워크 (공장 아님 — 딜러 재고 지표)',
    country: 'USA',
    startYearMonth: 202606,
    endYearMonth: 202607,
    eventType: 'inventory',
    models: ['Jeep', 'Ram', 'Chrysler', 'Dodge'],
    summary:
      '2026년 6월 미국 딜러 재고가 93 판매일수·전년 대비 약 12만 대 증가로 쌓였고(북미 출하 44.5만 대 +38% YoY vs 미국 판매 +6%), HSBC는 2024년과 같은 대규모 가격 인하·생산 감축을 반복해야 할 수 있다며 투자의견을 Reduce로 하향했다(목표가 EUR 5.50→4.00). "OEM 중 재고 증가율 최고"는 HSBC가 아니라 CarGurus 2026년 5월 리포트 기준이다.',
    statedReason:
      '출하가 소매를 크게 앞질러 재고 축적 — 북미 출하 44.5만 대(+38% YoY) 대비 미국 판매는 +6%에 그침',
    inventoryRelation: 'response_to_glut',
    sourceUrl:
      'https://finance.yahoo.com/markets/stocks/articles/hsbc-cuts-stellantis-reduce-u-165845724.html',
    sourceName: 'Yahoo Finance / GuruFocus',
    sourceDate: '2026-07-04',
  },
  {
    plant: 'Brampton Assembly',
    country: 'Canada',
    startYearMonth: 202607,
    endYearMonth: 202607,
    eventType: 'other',
    models: [],
    summary:
      '2026년 7월 기준 Brampton은 2023년 12월 생산 종료 이후 약 2년 7개월째 유휴 상태이며(2025년 2월 이후 리툴링 작업도 정지), Unifor Local 1285 위원장 Vito Beato는 2026년 9월 20일 만료되는 단협 교섭에서 Brampton에 대한 답이 없으면 합의는 없다며 2029년 이전 복귀 확약을 요구하고 있다.',
    statedReason: '2026년 9월 20일 단체협약 만료를 앞둔 교섭 — Brampton 재가동 확약 요구',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.insauga.com/union-says-no-deal-with-stellantis-unless-company-commits-to-brampton-assembly-plants-future/',
    sourceName: 'insauga (inBrampton)',
    sourceDate: '2026-07-08',
  },
  {
    plant: 'Belvidere Assembly Plant',
    country: 'USA',
    startYearMonth: 202701,
    endYearMonth: 202811,
    eventType: 'restart',
    models: ['Jeep Cherokee', 'Jeep Compass'],
    summary:
      '2026년 7월 기준 벨비디어는 여전히 유휴 상태지만 6억 달러 이상 투자로 약 3,300명 고용, 2027~2028년 생산 개시를 목표로 진행 중이다(노조 자료상 Compass 2027년 12월, Cherokee 2028년 11월). LaHood 하원의원과 시장이 공급업체 단지 조성 등 후속 과제를 논의했다.',
    statedReason:
      '6억 달러 이상 투자로 약 3,300명 고용 계획. 미 에너지부(DOE) 30억 달러 대출이 설비 개조를 뒷받침하며 트럼프 행정부가 대출 지원을 약속. 인프라(건널목 개량, 상하수도) 정비 병행',
    inventoryRelation: 'unrelated',
    sourceUrl:
      'https://www.wifr.com/2026/07/11/rep-lahood-belvidere-mayor-discuss-stellantis-reopening-work-ahead/',
    sourceName: 'WIFR (Rockford)',
    sourceDate: '2026-07-10',
  },
];
