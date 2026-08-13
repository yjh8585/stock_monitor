# OEM 차종 경쟁 분석 (`/oem/competition`) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 10개 핵심 차종의 AI 시장평가를, DB 판매·생산 실적과 지역별 경쟁차종 비교, Perplexity 웹검색(신형 출시·소비자 반응), NHTSA 리콜을 근거로 삼는 경쟁 분석으로 재작성하고 `/oem/competition` 전용 페이지에 싣는다.

**Architecture:** 지표 계산은 **Python 수집기 한 곳**에서 수행해 `oem_model_outlook`의 JSONB 컬럼에 저장하고, TypeScript 쪽은 계산 없이 표시만 한다(계산 로직 이중화 방지). 경쟁군 정의는 DB 테이블(`oem_competitor_set`)을 SSOT로 두어 Python·SQL 양쪽이 같은 값을 본다. MarkLines 원본 엑셀에만 있던 Segment·Type·PowerTrain은 92만 행 판매 테이블을 건드리지 않고 별도 매핑 테이블(`oem_model_segment`)로 살린다.

**Tech Stack:** Python 3.13 + postgrest-py + openpyxl + requests / Anthropic SDK(`claude-sonnet-5`) / Perplexity Search API / NHTSA 공개 API / Next.js 16 App Router + `'use cache'` / Supabase(PostgreSQL)

## Global Constraints

- **대상 차종은 기존 10개에서 늘리지 않는다.** 경쟁차종은 분석 근거와 화면 표시용으로만 쓰고 **경쟁차종별 카드를 만들지 않는다**(사용자 지시 2026-08-13).
- **북미 5종(`grand_cherokee`·`ram_truck`·`pacifica`·`rivian_r1`·`atlas`)은 `country='USA'`로 한정한다.** 실측 판매 비중 USA 89~93%.
- **다중 시장 차종은 시장별로 나눠 서술한다** — `seltos`(인도·미국·한국 3개), `avante_ex_china`(미국·한국 2개), `niro`(미국·유럽 2개).
- **생산-판매 갭은 국가별로 차감하지 않는다.** `oem_production_model_country_month.country`는 **공장 국가**, `oem_sales_model_country_month.country`는 **판매 시장**으로 의미가 정반대다(`Architecture.md:348`). 글로벌 합계로만 계산하고 화면에 "근사" 표기.
- **Cox 재고일수는 북미 4종에만 적용한다** — `cox_brand_inventory`에 Rivian 브랜드가 없고, 데이터가 미국 시장 한정이며 2개월 지연된다(최신 202606).
- **NHTSA는 미국 판매 차종에만 적용하고 모델연도 폴백을 둔다** — 2026년형이 미등록이면 2025 → 2024 순으로 재시도.
- 모델명 집계에서 **`'N/A'` 모델은 반드시 제외**한다(MarkLines 미분류 행이 각국 판매 1위로 잡힌다).
- **`oem_sales_model_country_month.country` 에 대륙 값(`'Europe'` 등)은 없다**(실측 확인). 시장별 집계는 `oem_competitor_set.countries`(국가 배열)로 `.in_()` 필터한다. `GLOBAL` 만 `NULL`(전 국가). 대륙명을 country 로 넘기면 조용히 0행이 나온다.
- **수집 주기는 월 1회(매월 21일 06:30 KST)** — cron `'30 21 20 * *'`. 주 1회 아님.
- **생산-판매 갭은 1차 범위에서 제외**한다. `compute_production_gap`을 만들지 않는다(YAGNI).
- `oem_model_outlook.region` 은 기존 값 체계(`'North America'` | `'Global'`)를 유지한다. 시장 코드(USA/India/…)를 넣지 않는다 — 시장별 세부는 `market_breakdown`이 담당한다.
- Python DB 접근은 `scripts/lib/db.py` 경유, mutating 스크립트는 `with WriteSession()` 필수. `supabase` SDK 금지.
- 신규 마이그레이션은 `supabase/migrations/20260813000NNN_*.sql`(직전 최대 = `20260806000001`).
- 파이썬·TS 모두 들여쓰기 2칸, UTF-8(BOM 없음) + LF. 파이썬 스크립트 첫머리에 `sys.stdout.reconfigure(encoding='utf-8', errors='replace')`.
- 검증: `npm run check-all`(TS) + `scripts/venv/Scripts/python.exe -m pytest scripts/lib -q`(Python).

## 운영 비용 · 수집 주기

**수집 주기 = 월 1회, 매월 21일 06:30 KST**(사용자 결정 2026-08-13). 근거: 판매(MarkLines)·재고(Cox)가 모두 **월 1회** 갱신이라 주 1회로 돌리면 4주 중 3주는 같은 숫자에 문장만 흔들려 노이즈가 된다. 21일로 잡은 이유는 전월 MarkLines 데이터가 확실히 들어오고 Cox 수집(매월 20일)이 끝난 뒤이기 때문.

**1회 실행 비용 (10개 차종)**

| 구분 | 내역 | 토큰 |
|---|---|---|
| 입력 | 시스템 프롬프트 200 / 판매 지표 300 / 경쟁표 300 / NHTSA 150 / Cox 50 | 1,000 |
| | **웹 검색 결과** (3쿼리 × 4건 × 700자) | 2,460 |
| | 입력 소계 | **약 3,460** |
| 출력 | 서술 5종(한글) 1,000 + 시장 코멘트 200 | 1,200 |
| | **thinking** (adaptive · effort high) | 2,000 |
| | 출력 소계 | **약 3,200** |

- Claude Sonnet 5: (3,460 × $3 + 3,200 × $15) / 1M = **$0.058/차종** → 10차종 **$0.58**
- Perplexity Search: 3쿼리 × 10차종 = 30회 × $5/1,000 = **$0.15**
- NHTSA: 무료
- **1회 = 약 $0.73 → 월 1회 기준 연 $8.8 (1.2만 원)**

비용의 66%가 thinking 토큰이다. 끄면 회당 $0.43까지 내려가지만 여러 표를 대조해 인과를 엮는 작업이라 품질 손실이 크다 — **켜둔다**.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `supabase/migrations/20260813000001_oem_model_segment.sql` | 모델×국가 → 세그먼트 매핑 테이블 |
| `supabase/migrations/20260813000002_oem_competitor_set.sql` | 경쟁군 정의 테이블 + 14개 시장 seed |
| `supabase/migrations/20260813000003_oem_model_outlook_v2.sql` | 평가 결과 컬럼 확장 |
| `scripts/import_oem_model_segment.py` | MarkLines 엑셀 → 세그먼트 매핑 적재 |
| `scripts/lib/perplexity_client.py` | Perplexity Search API 클라이언트 |
| `scripts/lib/nhtsa_client.py` | NHTSA 리콜·불만 조회 + 모델연도 폴백 |
| `scripts/lib/competition_metrics.py` | 판매·점유율·생산갭 계산 (순수 함수) |
| `scripts/collect_oem_model_outlook.py` | 수집기 재작성 (오케스트레이션) |
| `lib/oem-competition/source.ts` | `'use cache'` fetch + 매핑 |
| `lib/oem-competition/types.ts` | JSONB 페이로드 타입 |
| `app/oem/competition/page.tsx` | 라우트 |
| `components/oem/CompetitionCards.tsx` | 차종 카드 |
| `.github/workflows/collect-oem-model-outlook.yml` | 시크릿 2개 추가 |

---

### Task 1: 모델 세그먼트 매핑 테이블

**Files:**
- Create: `supabase/migrations/20260813000001_oem_model_segment.sql`
- Create: `scripts/import_oem_model_segment.py`
- Test: `scripts/lib/test_model_segment.py`

**Interfaces:**
- Produces: 테이블 `oem_model_segment(model, country, vehicle_type, segment, powertrains)`; 함수 `parse_segment_rows(rows) -> list[dict]`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- supabase/migrations/20260813000001_oem_model_segment.sql
-- MarkLines 판매 엑셀의 Type/Segment/PowerTrain 컬럼을 살린 매핑 테이블.
-- 92만 행 oem_sales_model_country_month 를 UPDATE 하지 않기 위해 별도 테이블로 분리한다
-- (전 행 UPDATE 는 WAL 을 폭증시켜 Supabase 용량을 위협한다 — 2026-08-03 사고 이력).

CREATE TABLE IF NOT EXISTS oem_model_segment (
  model        text NOT NULL,
  country      text NOT NULL,
  vehicle_type text NOT NULL,
  segment      text NOT NULL,
  powertrains  text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (model, country)
);

CREATE INDEX IF NOT EXISTS idx_oms_segment ON oem_model_segment(country, segment);

ALTER TABLE oem_model_segment ENABLE ROW LEVEL SECURITY;
CREATE POLICY oem_model_segment_read ON oem_model_segment FOR SELECT TO anon, authenticated USING (true);

-- 동일 값 재적재 시 WAL 낭비 방지 (20260803000002 과 같은 트리거 재사용)
CREATE TRIGGER trg_oms_skip_identical
  BEFORE UPDATE ON oem_model_segment
  FOR EACH ROW EXECUTE FUNCTION skip_identical_update();
```

- [ ] **Step 2: 파싱 순수 함수의 실패 테스트 작성**

```python
# scripts/lib/test_model_segment.py
from lib.model_segment import parse_segment_rows


def test_동일_모델국가의_파워트레인이_배열로_합쳐진다():
  rows = [
    ('USA', 'Ford Group', 'Ford', 'Light Trucks', 'SUV-D', 'Explorer', 'HV'),
    ('USA', 'Ford Group', 'Ford', 'Light Trucks', 'SUV-D', 'Explorer', 'ICE'),
  ]
  out = parse_segment_rows(rows)
  assert len(out) == 1
  assert out[0]['model'] == 'Explorer'
  assert sorted(out[0]['powertrains']) == ['HV', 'ICE']


def test_NA_모델은_제외된다():
  rows = [('USA', 'G', 'B', 'Cars', 'C', 'N/A', 'ICE')]
  assert parse_segment_rows(rows) == []


def test_세그먼트가_비면_제외된다():
  rows = [('USA', 'G', 'B', 'Cars', None, 'Foo', 'ICE')]
  assert parse_segment_rows(rows) == []
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_model_segment.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'lib.model_segment'`

- [ ] **Step 4: 최소 구현**

```python
# scripts/lib/model_segment.py
"""MarkLines 판매 엑셀의 (Country, Type, Segment, Model, PowerTrain) → 매핑 행 변환.

엑셀 헤더는 sync_oem_excel.py 의 EXPECTED_HEADER_PREFIX 와 동일하다:
  ('Country', 'Group', 'Maker/Brand', 'Type', 'Segment', 'Model', 'PowerTrain')
'N/A' 모델은 MarkLines 미분류 행이라 각국 판매 1위로 잡히므로 반드시 제외한다.
"""

EXCLUDED_MODELS = {'N/A', 'N/A (Trucks)'}


def parse_segment_rows(rows) -> list[dict]:
  """엑셀 메타 7열 튜플 목록 → oem_model_segment upsert 행 목록 (멱등·중복 병합)."""
  acc: dict[tuple[str, str], dict] = {}
  for row in rows:
    if not row or len(row) < 7:
      continue
    country, _group, _brand, vehicle_type, segment, model, powertrain = row[:7]
    if not model or not country or not segment or not vehicle_type:
      continue
    model = str(model).strip()
    if model in EXCLUDED_MODELS or model.startswith('N/A'):
      continue
    key = (model, str(country).strip())
    entry = acc.setdefault(key, {
      'model': key[0],
      'country': key[1],
      'vehicle_type': str(vehicle_type).strip(),
      'segment': str(segment).strip(),
      'powertrains': set(),
    })
    if powertrain and str(powertrain).strip() not in ('', 'N/A'):
      entry['powertrains'].add(str(powertrain).strip())
  return [
    {**v, 'powertrains': sorted(v['powertrains'])}
    for v in acc.values()
  ]
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_model_segment.py -q`
Expected: PASS (3 passed)

- [ ] **Step 6: 적재 스크립트 작성**

```python
# scripts/import_oem_model_segment.py
#!/usr/bin/env python3
"""MarkLines 판매 엑셀 → oem_model_segment 적재 (멱등).

`참고/oem 판매량/MarkLines_sales_data*.xlsx` 전부를 읽어 (model, country) 유니크로 병합한다.
연도별 파일에 같은 모델이 반복 등장하므로 최신 파일이 나중에 오도록 파일명 정렬 순서를 지킨다.
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path(__file__).parent))

from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)

from openpyxl import load_workbook  # noqa: E402
from loguru import logger  # noqa: E402

from lib.db import WriteSession, upsert_rows  # noqa: E402
from lib.model_segment import parse_segment_rows  # noqa: E402

EXCEL_GLOB = '참고/oem 판매량/MarkLines_sales_data*.xlsx'


def main() -> int:
  root = Path(__file__).parent.parent
  paths = sorted(root.glob(EXCEL_GLOB))
  if not paths:
    logger.error(f'엑셀 없음 — {EXCEL_GLOB}')
    return 1

  merged: dict[tuple[str, str], dict] = {}
  for path in paths:
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb['Sheet1']
    raw = list(ws.iter_rows(min_row=3, max_col=7, values_only=True))
    wb.close()
    for row in parse_segment_rows(raw):
      merged[(row['model'], row['country'])] = row
    logger.info(f'{path.name}: 누적 {len(merged):,}건')

  rows = list(merged.values())
  with WriteSession():
    upsert_rows('oem_model_segment', rows, conflict_cols='model,country')
  logger.success(f'oem_model_segment {len(rows):,}건 적재 완료')
  return 0


if __name__ == '__main__':
  sys.exit(main())
```

- [ ] **Step 7: 마이그레이션 적용 후 적재 실행**

Run:
```powershell
scripts/venv/Scripts/python.exe scripts/import_oem_model_segment.py
```
Expected: `oem_model_segment N건 적재 완료` (수만 행 규모). 실패 시 엑셀 헤더가 `EXPECTED_HEADER_PREFIX`와 일치하는지 먼저 확인.

- [ ] **Step 8: 적재 결과 검증 (샘플 대조)**

Run:
```powershell
scripts/venv/Scripts/python.exe -c "import sys;sys.path.insert(0,'scripts');from lib.bootstrap import init_script;init_script('scripts/x.py');from lib.db import get_client;c=get_client();print(c.table('oem_model_segment').select('*').eq('country','USA').in_('model',['Grand Cherokee (Jeep (2009-))','Explorer','Ram P/U']).execute().data)"
```
Expected: Grand Cherokee = `SUV-E`, Explorer = `SUV-D`, Ram P/U = `Pickup Truck`

- [ ] **Step 9: 커밋**

```bash
git add supabase/migrations/20260813000001_oem_model_segment.sql scripts/lib/model_segment.py scripts/lib/test_model_segment.py scripts/import_oem_model_segment.py
git commit -m "feat(oem): MarkLines Segment/Type/PowerTrain 매핑 테이블 신설

92만 행 판매 테이블을 UPDATE 하지 않고 (model, country) 매핑 테이블로 분리해
세그먼트 기반 경쟁군 구성과 점유율 계산의 근거를 만든다."
```

---

### Task 2: 경쟁군 정의 테이블 (SSOT)

**Files:**
- Create: `supabase/migrations/20260813000002_oem_competitor_set.sql`
- Test: `scripts/lib/test_competitor_set.py`

**Interfaces:**
- Consumes: Task 1의 `oem_model_segment`(검증용)
- Produces: 테이블 `oem_competitor_set(model_key, market, market_label, display_order, target_models, competitor_models, segment_note)` — 14개 행

- [ ] **Step 1: 마이그레이션 + seed 작성**

```sql
-- supabase/migrations/20260813000002_oem_competitor_set.sql
-- 차종 × 시장 경쟁군 정의. Python 수집기와 SQL 검증이 같은 값을 보도록 DB 를 SSOT 로 둔다.
--
-- 시장 선정 근거(2025.01~2026.07 실측 판매 비중):
--   북미 5종 USA 89~93% → USA 한정
--   porsche_911 USA 33/독일 21/영국 7 → 지배 시장 없어 GLOBAL
--   seltos 인도 31/미국 23/한국 18 → 3개 시장 분리
--   avante_ex_china 미국 53/한국 23 → 2개 / niro 미국 27/유럽 합계 약 25 → 2개
--
-- ⚠️ MarkLines Segment 를 그대로 쓰면 안 된다: Grand Cherokee 는 SUV-E, Explorer·Traverse·
--    Atlas 는 SUV-D 로 갈리지만 실제로는 같은 시장에서 경쟁한다. 그래서 자동 분류가 아니라
--    이 표를 수동 정본으로 둔다.

-- ⚠️ `countries` 가 실제 집계 필터다. oem_sales_model_country_month.country 에는 'Europe' 같은
--    대륙 값이 없고 개별 국가만 있다(실측 확인). 'Europe' 을 country 로 넘기면 0행이 나오거나
--    전 국가 합산으로 뭉개진다. GLOBAL 만 NULL(전 국가)이고 나머지는 국가 배열을 명시한다.

CREATE TABLE IF NOT EXISTS oem_competitor_set (
  model_key         text NOT NULL,
  market            text NOT NULL,   -- 논리적 시장 코드 (USA/India/Korea/China/Europe/GLOBAL)
  market_label      text NOT NULL,
  display_order     int  NOT NULL,
  countries         text[],          -- 집계 대상 국가. NULL = 전 국가(GLOBAL)
  target_models     text[] NOT NULL,
  competitor_models text[] NOT NULL,
  segment_note      text,
  PRIMARY KEY (model_key, market)
);

ALTER TABLE oem_competitor_set ENABLE ROW LEVEL SECURITY;
CREATE POLICY oem_competitor_set_read ON oem_competitor_set FOR SELECT TO anon, authenticated USING (true);

-- 유럽 집계 국가 — NIRO 판매 실측 상위(Spain 18.0k · UK 17.6k · France 9.4k · Netherlands 8.8k ·
-- Italy 3.1k · Sweden 2.4k · Germany 2.2k · Poland 1.4k)에 인접 서유럽 시장을 더한 집합.
-- 대상 차종과 경쟁 차종에 같은 집합을 적용해야 점유율이 공정하다.

INSERT INTO oem_competitor_set
  (model_key, market, market_label, display_order, countries, target_models, competitor_models, segment_note)
VALUES
  ('grand_cherokee', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['Grand Cherokee (Jeep (2009-))'],
   ARRAY['Explorer','Traverse','Grand Highlander','Telluride','Palisade','Honda Pilot','Highlander'],
   'SUV-E 이지만 실질 경쟁은 SUV-D 3열 SUV'),

  ('ram_truck', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['Ram P/U'],
   ARRAY['Ford F-Series','Silverado','GMC Sierra','Tundra','Nissan Titan'],
   'Pickup Truck 풀사이즈'),

  ('pacifica', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['Pacifica (Chrysler (2009-))'],
   ARRAY['Odyssey','Sienna','Carnival (Sedona)'],
   'MPV(미니밴)'),

  ('rivian_r1', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['R1T','R1S'],
   ARRAY['Model X','Cybertruck','Hummer SUV','Hummer Pickup','Lucid Air','EV9','IONIQ 5'],
   '프리미엄 전기 SUV/픽업 — MarkLines 세그먼트로 안 잡혀 수동 지정'),

  ('atlas', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['VW Atlas'],
   ARRAY['Explorer','Traverse','Grand Highlander','Telluride','Palisade','Honda Pilot','Highlander','Grand Cherokee (Jeep (2009-))'],
   'SUV-D 3열 SUV'),

  ('porsche_911', 'GLOBAL', '글로벌', 1, NULL,
   ARRAY['Porsche 911'],
   ARRAY['Corvette','Boxster/Cayman','Supra','Nissan Z','F-Type'],
   'Segment F 스포츠카 — 미국 33%/독일 21%로 지배 시장 없음'),

  ('seltos', 'India', '인도', 1, ARRAY['India'],
   ARRAY['SELTOS'],
   ARRAY['Creta (ix25)','Venue','Nexon','Brezza','Sonet','XUV 3XO'],
   'SUV-C'),
  ('seltos', 'USA', '미국', 2, ARRAY['USA'],
   ARRAY['SELTOS'],
   ARRAY['HR-V','Kona','Crosstrek','Corolla Cross','Trailblazer'],
   'SUV-C'),
  ('seltos', 'Korea', '한국', 3, ARRAY['Korea'],
   ARRAY['SELTOS'],
   ARRAY['Kona','Casper','EV3','Trailblazer'],
   'SUV-C'),

  ('avante_ex_china', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['Avante (Elantra)','Avante'],
   ARRAY['Civic','Corolla','Sentra','Jetta','K4'],
   '준중형 세단'),
  ('avante_ex_china', 'Korea', '한국', 2, ARRAY['Korea'],
   ARRAY['Avante (Elantra)','Avante'],
   ARRAY['K5','Sonata/YF Sonata/LF Sonata','Casper'],
   '준중형 세단'),

  ('avante_china', 'China', '중국', 1, ARRAY['China'],
   ARRAY['Elantra/Yuedong/Langdong/Elantra 2016','Elantra Yuedong'],
   ARRAY['Bluebird Sylphy/Sylphy','Lavida','Sagitar','Qin PLUS','Qin L'],
   '중국 준중형 세단 — 전기·PHEV 전환이 최대 변수'),

  ('niro', 'USA', '미국', 1, ARRAY['USA'],
   ARRAY['NIRO'],
   ARRAY['HR-V','Kona','Corolla Cross','Crosstrek'],
   'SUV-C 하이브리드/EV'),
  ('niro', 'Europe', '유럽', 2,
   ARRAY['Germany','UK','France','Italy','Spain','Netherlands','Sweden','Poland',
         'Belgium','Austria','Norway','Denmark','Portugal','Switzerland'],
   ARRAY['NIRO'],
   ARRAY['Kona','Captur','Puma','2008'],
   'SUV-C — 서유럽 14개국 합산')
ON CONFLICT (model_key, market) DO NOTHING;
```

- [ ] **Step 2: 경쟁군 모델명이 실제 DB 에 존재하는지 검증 테스트 작성**

```python
# scripts/lib/test_competitor_set.py
"""경쟁군에 적은 모델명이 실제 판매 테이블에 존재하는지 확인한다.

오타 하나로 경쟁군 점유율이 조용히 틀어지므로 DB 를 직접 조회해 검증한다.
DB 접근이 안 되는 환경(CI 등)에서는 스킵한다.
"""
import os

import pytest

pytestmark = pytest.mark.skipif(
  not os.environ.get('SUPABASE_URL'), reason='DB 미설정 환경에서는 스킵'
)


def test_모든_경쟁군_모델이_판매테이블에_존재한다():
  from lib.db import get_client

  c = get_client()
  sets = c.table('oem_competitor_set').select('*').execute().data
  assert sets, 'oem_competitor_set 이 비어 있다'
  assert len(sets) == 14, f'시장 정의는 14개여야 하는데 {len(sets)}개'

  missing = []
  for s in sets:
    countries = s.get('countries')  # NULL = 전 국가(GLOBAL)
    for model in list(s['target_models']) + list(s['competitor_models']):
      q = c.table('oem_sales_model_country_month').select('model').eq('model', model).gte('year_month', 202501)
      if countries:
        q = q.in_('country', countries)
      if not (q.limit(1).execute().data or []):
        missing.append(f"{s['model_key']}/{s['market']}: {model}")
  assert not missing, '판매 테이블에 없는 모델명:\n' + '\n'.join(missing)


def test_GLOBAL_외의_시장은_countries가_채워져_있다():
  """'Europe' 같은 값을 country 로 직접 넘기면 0행이 나온다 — countries 배열이 실제 필터다."""
  from lib.db import get_client

  c = get_client()
  for s in c.table('oem_competitor_set').select('model_key,market,countries').execute().data:
    if s['market'] == 'GLOBAL':
      assert not s['countries'], f"{s['model_key']}/GLOBAL 은 countries 가 NULL 이어야 한다"
    else:
      assert s['countries'], f"{s['model_key']}/{s['market']} 에 countries 가 비어 있다"
```

- [ ] **Step 3: 마이그레이션 적용 후 테스트 실행**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_competitor_set.py -q`
Expected: PASS. 실패하면 출력된 모델명을 DB 실제 표기로 고쳐 마이그레이션을 **새 번호로** 추가(기존 파일 수정 금지).

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/20260813000002_oem_competitor_set.sql scripts/lib/test_competitor_set.py
git commit -m "feat(oem): 차종x시장 경쟁군 정의 테이블 신설 (14개 시장)"
```

---

### Task 3: `oem_model_outlook` 스키마 확장

**Files:**
- Create: `supabase/migrations/20260813000003_oem_model_outlook_v2.sql`

**Interfaces:**
- Produces: `oem_model_outlook`에 `competitive_view`·`sales_trend`·`market_breakdown`·`metrics`·`sources` 컬럼

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- supabase/migrations/20260813000003_oem_model_outlook_v2.sql
-- AI 차종 평가 v2 — 경쟁 현황·판매 추이·시장별 분해·근거 지표·출처를 분리 저장한다.
-- 기존 3개 서술 컬럼(consumer_view/outlook/rationale)은 유지하고 추가만 한다.

ALTER TABLE oem_model_outlook
  ADD COLUMN IF NOT EXISTS competitive_view  text,
  ADD COLUMN IF NOT EXISTS sales_trend       text,
  ADD COLUMN IF NOT EXISTS market_breakdown  jsonb,
  ADD COLUMN IF NOT EXISTS metrics           jsonb,
  ADD COLUMN IF NOT EXISTS sources           jsonb;

COMMENT ON COLUMN oem_model_outlook.competitive_view IS '경쟁 현황 서술 — 경쟁차 신형/판매 증감 대비';
COMMENT ON COLUMN oem_model_outlook.sales_trend      IS '판매 추이 서술 — YoY·점유율 변화';
COMMENT ON COLUMN oem_model_outlook.market_breakdown IS '[{market,label,share_pct,sales,yoy_pct,comment}] 시장별 분해';
COMMENT ON COLUMN oem_model_outlook.metrics          IS 'AI 에 넘긴 계산 지표 원본(감사·재현용)';
COMMENT ON COLUMN oem_model_outlook.sources          IS '[{title,url,date}] Perplexity 검색 출처';
```

- [ ] **Step 2: 마이그레이션 적용 후 컬럼 확인**

Run: Supabase MCP `list_tables` 또는
```powershell
scripts/venv/Scripts/python.exe -c "import sys;sys.path.insert(0,'scripts');from lib.bootstrap import init_script;init_script('scripts/x.py');from lib.db import get_client;print(list((get_client().table('oem_model_outlook').select('*').limit(1).execute().data or [{}])[0].keys()))"
```
Expected: `competitive_view`, `sales_trend`, `market_breakdown`, `metrics`, `sources` 포함

- [ ] **Step 3: TypeScript 타입 재생성**

Run: Supabase MCP `generate_typescript_types` → `lib/database.types.ts` 갱신
⚠️ 파일 끝의 **수동 헬퍼(`ViewRow`/`TableRow`)가 덮여 사라지므로 복원 후 `npm run format`**(메모리 `project_database_types_helpers.md`).

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/20260813000003_oem_model_outlook_v2.sql lib/database.types.ts
git commit -m "feat(oem): AI 차종 평가 v2 컬럼 추가 (경쟁현황·판매추이·시장분해·지표·출처)"
```

---

### Task 4: Perplexity Search 클라이언트

**Files:**
- Create: `scripts/lib/perplexity_client.py`
- Test: `scripts/lib/test_perplexity_client.py`

**Interfaces:**
- Produces: `search(query: str, *, max_results: int = 5, recency_days: int | None = None) -> list[SearchResult]`, `build_model_queries(model_name: str, competitors: list[str]) -> list[str]`

- [ ] **Step 1: 실패 테스트 작성**

```python
# scripts/lib/test_perplexity_client.py
from lib.perplexity_client import build_model_queries, parse_search_response


def test_차종당_3개_검색어가_생성된다():
  qs = build_model_queries('Jeep Grand Cherokee', ['Explorer', 'Traverse'])
  assert len(qs) == 3
  assert any('redesign' in q for q in qs)
  assert any('complaints' in q or 'review' in q for q in qs)
  assert any('Explorer' in q for q in qs)


def test_응답_파싱이_필요한_필드만_남긴다():
  raw = {'id': 'x', 'results': [
    {'title': 'T', 'url': 'https://a', 'date': '2026-08-12', 'snippet': 'S' * 900,
     'last_updated': '2026-08-12'},
  ]}
  out = parse_search_response(raw, snippet_limit=100)
  assert out == [{'title': 'T', 'url': 'https://a', 'date': '2026-08-12', 'snippet': 'S' * 100}]


def test_결과가_없으면_빈리스트():
  assert parse_search_response({'results': []}) == []
  assert parse_search_response({}) == []
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_perplexity_client.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'lib.perplexity_client'`

- [ ] **Step 3: 구현**

```python
# scripts/lib/perplexity_client.py
"""Perplexity Search API 클라이언트.

Claude 내장 웹검색 대신 이걸 쓰는 이유: 검색어를 우리가 고정할 수 있어 매주 같은 관점의
최신 결과가 보장된다(모델 자율 검색은 주마다 검색어가 달라져 편차가 크다). 가격도 절반
($5/1,000 vs $10/1,000).

엔드포인트: POST https://api.perplexity.ai/search
응답: {'id': ..., 'results': [{'title','url','date','last_updated','snippet'}, ...]}
키: PERPLEXITY_API_KEY (scripts/.env · .env.local · GitHub Secrets)
"""
import os

import requests
from loguru import logger

API_URL = 'https://api.perplexity.ai/search'
TIMEOUT = 40
SNIPPET_LIMIT = 700


def build_model_queries(model_name: str, competitors: list[str]) -> list[str]:
  """차종 1개에 대한 고정 검색어 3종 — 신형/소비자/경쟁 관점."""
  rivals = ' OR '.join(competitors[:3]) if competitors else 'competitors'
  return [
    f'{model_name} redesign OR facelift OR next generation 2026 2027',
    f'{model_name} owner complaints reliability review 2026',
    f'{model_name} vs {rivals} comparison sales 2026',
  ]


def parse_search_response(raw: dict, snippet_limit: int = SNIPPET_LIMIT) -> list[dict]:
  """API 응답 → 프롬프트에 넣을 최소 필드만. 스니펫은 토큰 절약을 위해 자른다."""
  out = []
  for item in (raw or {}).get('results') or []:
    title = (item.get('title') or '').strip()
    url = (item.get('url') or '').strip()
    if not title or not url:
      continue
    out.append({
      'title': title,
      'url': url,
      'date': (item.get('date') or item.get('last_updated') or '')[:10],
      'snippet': (item.get('snippet') or '').strip()[:snippet_limit],
    })
  return out


def search(query: str, *, max_results: int = 5, recency_days: int | None = None) -> list[dict]:
  """검색 1회. 실패는 빈 리스트로 흡수한다(웹 결과가 없어도 평가 자체는 진행)."""
  key = os.environ.get('PERPLEXITY_API_KEY')
  if not key:
    logger.warning('PERPLEXITY_API_KEY 미설정 — 웹 검색 건너뜀')
    return []
  payload: dict = {'query': query, 'max_results': max_results, 'max_tokens_per_page': 512}
  if recency_days:
    payload['search_recency_filter'] = f'{recency_days}d'
  try:
    r = requests.post(
      API_URL,
      headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
      json=payload,
      timeout=TIMEOUT,
    )
  except requests.RequestException as e:
    logger.warning(f'Perplexity 호출 실패 — {e}')
    return []
  if r.status_code != 200:
    logger.warning(f'Perplexity HTTP {r.status_code} — {r.text[:200]}')
    return []
  return parse_search_response(r.json())
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_perplexity_client.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: 실호출 스모크 확인**

Run:
```powershell
scripts/venv/Scripts/python.exe -c "import sys;sys.path.insert(0,'scripts');from lib.bootstrap import init_script;init_script('scripts/x.py');from lib.perplexity_client import search;r=search('Jeep Grand Cherokee redesign 2027',max_results=3);print(len(r));print(r[0]['date'],r[0]['title'][:60]) if r else print('EMPTY')"
```
Expected: 3건, 최근 날짜와 제목 출력

- [ ] **Step 6: 커밋**

```bash
git add scripts/lib/perplexity_client.py scripts/lib/test_perplexity_client.py
git commit -m "feat(scripts): Perplexity Search API 클라이언트 추가"
```

---

### Task 5: NHTSA 리콜·불만 클라이언트

**Files:**
- Create: `scripts/lib/nhtsa_client.py`
- Test: `scripts/lib/test_nhtsa_client.py`

**Interfaces:**
- Produces: `NHTSA_MODEL_MAP: dict[str, tuple[str, str]]`, `fetch_safety(model_key, *, years) -> dict | None`

- [ ] **Step 1: 실패 테스트 작성**

```python
# scripts/lib/test_nhtsa_client.py
from lib.nhtsa_client import NHTSA_MODEL_MAP, summarize_recalls


def test_미국_판매_차종만_매핑에_있다():
  assert 'grand_cherokee' in NHTSA_MODEL_MAP
  assert NHTSA_MODEL_MAP['grand_cherokee'] == ('jeep', 'grand cherokee')
  # 중국 전용 차종은 미국 NHTSA 대상이 아니다
  assert 'avante_china' not in NHTSA_MODEL_MAP


def test_리콜_요약이_부품군별로_집계된다():
  results = [
    {'Component': 'ELECTRICAL SYSTEM:PROPULSION', 'Summary': 'a', 'ReportReceivedDate': '01/02/2026'},
    {'Component': 'ELECTRICAL SYSTEM:PROPULSION', 'Summary': 'b', 'ReportReceivedDate': '02/02/2026'},
    {'Component': 'ENGINE', 'Summary': 'c', 'ReportReceivedDate': '03/02/2026'},
  ]
  out = summarize_recalls(results)
  assert out['count'] == 3
  assert out['top_components'][0] == ('ELECTRICAL SYSTEM:PROPULSION', 2)


def test_빈_결과는_0건으로():
  assert summarize_recalls([])['count'] == 0
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_nhtsa_client.py -q`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```python
# scripts/lib/nhtsa_client.py
"""NHTSA(미국 도로교통안전국) 공개 API — 차종별 리콜·소비자 불만.

무료·무인증. 미국 등록 차량 한정이라 미국에서 팔지 않는 차종(avante_china)은 제외한다.
모델연도가 아직 등록되지 않으면 Count 0 또는 HTTP 400 이 오므로 최신 연도부터 폴백한다
(실측: 2026 Jeep Grand Cherokee 는 리콜 3건·불만 11건, 2026 Kia Seltos 는 0건).
"""
import requests
from loguru import logger

RECALL_URL = 'https://api.nhtsa.gov/recalls/recallsByVehicle'
COMPLAINT_URL = 'https://api.nhtsa.gov/complaints/complaintsByVehicle'
TIMEOUT = 30

# model_key → (NHTSA make, NHTSA model). MarkLines 표기와 다르므로 수동 매핑한다.
NHTSA_MODEL_MAP: dict[str, tuple[str, str]] = {
  'grand_cherokee': ('jeep', 'grand cherokee'),
  'ram_truck': ('ram', '1500'),
  'pacifica': ('chrysler', 'pacifica'),
  'rivian_r1': ('rivian', 'r1s'),
  'atlas': ('volkswagen', 'atlas'),
  'porsche_911': ('porsche', '911'),
  'seltos': ('kia', 'seltos'),
  'avante_ex_china': ('hyundai', 'elantra'),
  'niro': ('kia', 'niro'),
  # avante_china 는 미국 미판매 → 제외
}


def summarize_recalls(results: list[dict]) -> dict:
  """리콜 목록 → {count, top_components:[(부품군, 건수)], latest:[요약 2건]}"""
  counts: dict[str, int] = {}
  for r in results or []:
    comp = (r.get('Component') or '기타').strip()
    counts[comp] = counts.get(comp, 0) + 1
  top = sorted(counts.items(), key=lambda kv: -kv[1])[:3]
  latest = [(r.get('Summary') or '')[:180] for r in (results or [])[:2]]
  return {'count': len(results or []), 'top_components': top, 'latest': latest}


def _get(url: str, make: str, model: str, year: int) -> list[dict] | None:
  try:
    r = requests.get(url, params={'make': make, 'model': model, 'modelYear': year}, timeout=TIMEOUT)
  except requests.RequestException as e:
    logger.warning(f'NHTSA 호출 실패 {make}/{model}/{year} — {e}')
    return None
  if r.status_code != 200:
    return None
  data = r.json()
  return data.get('results') or []


def fetch_safety(model_key: str, *, years: list[int]) -> dict | None:
  """model_key 의 리콜·불만 요약. 매핑이 없거나 전 연도가 비면 None."""
  mapped = NHTSA_MODEL_MAP.get(model_key)
  if not mapped:
    return None
  make, model = mapped
  for year in years:
    recalls = _get(RECALL_URL, make, model, year)
    if recalls:
      complaints = _get(COMPLAINT_URL, make, model, year) or []
      return {
        'model_year': year,
        'recalls': summarize_recalls(recalls),
        'complaint_count': len(complaints),
      }
  logger.info(f'NHTSA 데이터 없음 — {model_key} ({years})')
  return None
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_nhtsa_client.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: 실호출 스모크 확인**

Run:
```powershell
scripts/venv/Scripts/python.exe -c "import sys;sys.path.insert(0,'scripts');from lib.nhtsa_client import fetch_safety;print(fetch_safety('grand_cherokee',years=[2026,2025,2024]))"
```
Expected: `{'model_year': 2026, 'recalls': {'count': 3, ...}, 'complaint_count': 11}`

- [ ] **Step 6: 커밋**

```bash
git add scripts/lib/nhtsa_client.py scripts/lib/test_nhtsa_client.py
git commit -m "feat(scripts): NHTSA 리콜·불만 클라이언트 (모델연도 폴백)"
```

---

### Task 6: 경쟁 지표 계산 모듈

**Files:**
- Create: `scripts/lib/competition_metrics.py`
- Test: `scripts/lib/test_competition_metrics.py`

**Interfaces:**
- Consumes: Task 2의 `oem_competitor_set` 행 구조
- Produces: `compute_market_metrics(target_rows, competitor_rows, *, months) -> dict`, `compute_production_gap(sales_rows, production_rows) -> dict`

- [ ] **Step 1: 실패 테스트 작성**

```python
# scripts/lib/test_competition_metrics.py
from lib.competition_metrics import compute_market_metrics


def _row(ym, sales, model='T'):
  return {'year_month': ym, 'sales': sales, 'model': model}


def test_YoY와_경쟁군점유율이_계산된다():
  target = [_row(202501, 100), _row(202502, 100), _row(202601, 90), _row(202602, 90)]
  rivals = [_row(202501, 300, 'R'), _row(202502, 300, 'R'),
            _row(202601, 410, 'R'), _row(202602, 410, 'R')]
  m = compute_market_metrics(target, rivals, months=2)
  assert m['recent_sales'] == 180
  assert m['prev_year_sales'] == 200
  assert m['yoy_pct'] == -10.0
  # 점유율 180/(180+820)=18.0% ← 200/(200+600)=25.0%
  assert m['share_pct'] == 18.0
  assert m['prev_share_pct'] == 25.0


def test_경쟁군이_비면_점유율은_None():
  m = compute_market_metrics([_row(202601, 10)], [], months=1)
  assert m['share_pct'] is None


def test_경쟁표는_판매량_내림차순으로_정렬된다():
  from lib.competition_metrics import compute_competitor_table

  out = compute_competitor_table(
    {'A': [_row(202601, 10)], 'B': [_row(202601, 30)]}, months=1
  )
  assert [x['model'] for x in out] == ['B', 'A']
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_competition_metrics.py -q`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```python
# scripts/lib/competition_metrics.py
"""차종 경쟁 지표 계산 — 순수 함수만 둔다(DB 접근 없음).

계산을 Python 한 곳에서만 하고 결과를 oem_model_outlook.metrics(JSONB)에 저장한다.
TypeScript 쪽은 표시만 하므로 계산 로직이 두 언어로 갈리지 않는다.
"""


def _sum(rows: list[dict], field: str) -> int:
  return sum(int(r.get(field) or 0) for r in rows)


def _window(rows: list[dict], months: int, offset_years: int = 0) -> list[dict]:
  """최근 N개월(offset_years=1 이면 1년 전 동기간) 행만."""
  if not rows:
    return []
  latest = max(r['year_month'] for r in rows)
  y, m = divmod(latest, 100)
  y -= offset_years
  end = y * 100 + m
  start_total = (y * 12 + m - 1) - (months - 1)
  start = (start_total // 12) * 100 + (start_total % 12) + 1
  return [r for r in rows if start <= r['year_month'] <= end]


def compute_market_metrics(target_rows: list[dict], competitor_rows: list[dict], *, months: int) -> dict:
  """한 시장의 대상 차종 지표 — 최근 N개월 판매, YoY, 경쟁군 내 점유율(현재/전년)."""
  recent = _sum(_window(target_rows, months), 'sales')
  prev = _sum(_window(target_rows, months, offset_years=1), 'sales')
  rivals_recent = _sum(_window(competitor_rows, months), 'sales')
  rivals_prev = _sum(_window(competitor_rows, months, offset_years=1), 'sales')

  def share(part: int, others: int) -> float | None:
    total = part + others
    return round(part * 100 / total, 1) if total > 0 and others > 0 else None

  return {
    'months': months,
    'recent_sales': recent,
    'prev_year_sales': prev,
    'yoy_pct': round((recent - prev) * 100 / prev, 1) if prev else None,
    'share_pct': share(recent, rivals_recent),
    'prev_share_pct': share(prev, rivals_prev),
    'competitor_sales': rivals_recent,
  }


def compute_competitor_table(rows_by_model: dict[str, list[dict]], *, months: int) -> list[dict]:
  """경쟁차종별 최근 N개월 판매·YoY 표 (AI 프롬프트·화면 공용)."""
  out = []
  for model, rows in rows_by_model.items():
    recent = _sum(_window(rows, months), 'sales')
    prev = _sum(_window(rows, months, offset_years=1), 'sales')
    out.append({
      'model': model,
      'sales': recent,
      'yoy_pct': round((recent - prev) * 100 / prev, 1) if prev else None,
    })
  return sorted(out, key=lambda x: -x['sales'])


```

> 생산-판매 갭(`compute_production_gap`)은 **1차 범위에서 제외**(사용자 결정 2026-08-13)라 이 모듈에 넣지 않는다. 쓰지 않을 함수를 미리 만들지 않는다 — 2차 확장 때 이 계획서 맨 아래 「2차 확장 항목」의 코드를 그대로 옮긴다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_competition_metrics.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: 커밋**

```bash
git add scripts/lib/competition_metrics.py scripts/lib/test_competition_metrics.py
git commit -m "feat(scripts): 경쟁 지표 계산 모듈 (점유율·YoY·생산갭)"
```

---

### Task 7: 수집기 재작성

**Files:**
- Modify: `scripts/collect_oem_model_outlook.py` (전면 재작성)
- Test: `scripts/lib/test_outlook_prompt.py`

**Interfaces:**
- Consumes: Task 2 `oem_competitor_set`, Task 4 `perplexity_client.search`, Task 5 `nhtsa_client.fetch_safety`, Task 6 `competition_metrics.*`
- Produces: `oem_model_outlook` 행 (v2 컬럼 포함)

- [ ] **Step 1: 프롬프트 조립 함수의 실패 테스트 작성**

```python
# scripts/lib/test_outlook_prompt.py
from lib.outlook_prompt import build_digest


def test_다이제스트에_판매표와_경쟁표와_검색결과가_모두_들어간다():
  digest = build_digest(
    model_name='Jeep Grand Cherokee',
    markets=[{
      'label': '미국', 'market': 'USA',
      'metrics': {'recent_sales': 115251, 'yoy_pct': -6.2, 'share_pct': 9.8, 'prev_share_pct': 12.4, 'months': 7},
      'competitors': [{'model': 'Explorer', 'sales': 145829, 'yoy_pct': 14.7}],
    }],
    production_gap={'sales_total': 100, 'production_total': 120, 'gap': 20},
    safety={'model_year': 2026, 'recalls': {'count': 3, 'top_components': [('ELECTRICAL', 2)], 'latest': ['a']}, 'complaint_count': 11},
    inventory={'brand': 'Jeep', 'days_supply': 95, 'year_month': 202606},
    web_results=[{'title': '2027 Grand Cherokee', 'url': 'https://x', 'date': '2026-08-12', 'snippet': 'Upland trim'}],
  )
  assert '115,251' in digest
  assert 'Explorer' in digest
  assert '2027 Grand Cherokee' in digest
  assert 'ELECTRICAL' in digest
  assert '95' in digest


def test_없는_섹션은_생략되고_에러가_나지_않는다():
  digest = build_digest(
    model_name='X', markets=[], production_gap=None, safety=None, inventory=None, web_results=[]
  )
  assert 'X' in digest
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_outlook_prompt.py -q`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 프롬프트 모듈 구현**

```python
# scripts/lib/outlook_prompt.py
"""AI 차종 평가 프롬프트 조립.

기존 수집기의 실패 원인은 입력이 '모회사 주식 뉴스 헤드라인 8개'뿐이라 모델이 사전지식으로만
쓴 것이었다(그래서 매주 돌려도 내용이 안 바뀌었다). v2 는 DB 실적·경쟁표·웹검색·리콜을 넣는다.
"""


def _fmt_market(m: dict) -> str:
  met = m.get('metrics') or {}
  lines = [
    f"[{m['label']} 시장]",
    f"  최근 {met.get('months', '?')}개월 판매: {met.get('recent_sales', 0):,}대"
    f" (전년동기 대비 {met.get('yoy_pct')}%)",
  ]
  if met.get('share_pct') is not None:
    lines.append(
      f"  경쟁군 내 점유율: {met['share_pct']}% (전년 {met.get('prev_share_pct')}%)"
    )
  rivals = m.get('competitors') or []
  if rivals:
    lines.append('  경쟁 차종 동기간 판매:')
    for r in rivals:
      lines.append(f"    - {r['model']}: {r['sales']:,}대 (YoY {r.get('yoy_pct')}%)")
  return '\n'.join(lines)


def build_digest(*, model_name, markets, production_gap, safety, inventory, web_results) -> str:
  """차종 1개의 프롬프트 입력 블록."""
  parts = [f'차종: {model_name}', '']
  for m in markets or []:
    parts.append(_fmt_market(m))
    parts.append('')
  if production_gap:
    parts.append(
      f"[생산-판매 갭 · 글로벌 합계 근사]\n"
      f"  생산 {production_gap['production_total']:,}대 / 판매 {production_gap['sales_total']:,}대"
      f" → 갭 {production_gap['gap']:+,}대"
    )
    parts.append('')
  if inventory:
    parts.append(
      f"[미국 딜러 재고일수 · {inventory['brand']} 브랜드 기준 {inventory['year_month']}]\n"
      f"  {inventory.get('days_supply')}일"
      + ('  ※ Cox 가 업계평균 2배 초과로 값을 감춤(위험 신호)' if inventory.get('days_supply') is None else '')
    )
    parts.append('')
  if safety:
    rec = safety['recalls']
    comps = ', '.join(f'{c}({n}건)' for c, n in rec.get('top_components') or [])
    parts.append(
      f"[NHTSA {safety['model_year']}년형]\n"
      f"  리콜 {rec['count']}건 {('— ' + comps) if comps else ''}\n"
      f"  소비자 불만 {safety['complaint_count']}건"
    )
    parts.append('')
  if web_results:
    parts.append('[최근 웹 검색 결과]')
    for w in web_results:
      parts.append(f"  - [{w.get('date') or '-'}] {w['title']}")
      if w.get('snippet'):
        parts.append(f"    {w['snippet']}")
    parts.append('')
  return '\n'.join(parts)


SYSTEM_PROMPT = """당신은 자동차 산업 애널리스트입니다. 주어진 판매 실적·경쟁 차종 비교·웹 검색
결과·리콜 데이터를 근거로 특정 차종의 경쟁 현황을 한국어로 분석합니다.

반드시 지킬 것:
- **숫자는 입력 데이터에 있는 것만 쓴다.** 없는 수치를 만들어내지 않는다.
- 경쟁 현황은 "경쟁차 A가 신형 출시로 +40%인 동안 대상 차종은 -6%" 같이 **대비 구조**로 쓴다.
- 웹 검색 결과에 풀체인지·페이스리프트 소식이 있으면 **연식과 함께** 명시한다.
- 추측은 완곡하게("…로 보인다"), 확인된 사실은 단정적으로 쓴다.
- 회사명·차종명은 원문 그대로(예: "Jeep Grand Cherokee").
"""
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_outlook_prompt.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: 수집기 본문 재작성**

`scripts/collect_oem_model_outlook.py`를 아래로 교체한다. 기존 `MODELS` 상수는 DB(`oem_competitor_set`)로 이관되므로 삭제하고, 차종 메타(이름·OEM·티커)만 남긴다.

```python
#!/usr/bin/env python3
"""핵심 차종 10종의 경쟁 분석을 Claude 로 생성해 oem_model_outlook 에 적재.

v2 (2026-08-13): 입력을 대폭 보강했다.
  - DB 판매 실적 + 지역별 경쟁군 비교 (oem_competitor_set 정본)
  - Perplexity 웹검색 (신형 출시·소비자 반응·경쟁 비교, 고정 검색어 3종)
  - NHTSA 리콜·불만 (미국 판매 차종만, 모델연도 폴백)
  - Cox 딜러 재고일수 (북미 4종, Rivian 제외)
  - 생산-판매 갭 (글로벌 합계 근사 — country 의미가 판매/생산 간 정반대라 국가별 차감 금지)

매월 21일 06:30 KST 에 .github/workflows/collect-oem-model-outlook.yml 가 호출한다.
주 1회가 아닌 이유: 판매(MarkLines)·재고(Cox)가 월 1회 갱신이라 주간 실행은 같은 숫자에
문장만 바뀌는 노이즈가 된다. 21일인 이유: 전월 판매 데이터와 Cox 수집(20일)이 끝난 뒤.
비용: 1회 약 $0.73 (Sonnet 5 $0.58 + Perplexity $0.15) → 연 $8.8.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path(__file__).parent))

from lib.bootstrap import init_script  # noqa: E402

init_script(__file__)

from anthropic import Anthropic  # noqa: E402
from loguru import logger  # noqa: E402

from lib.competition_metrics import (  # noqa: E402
  compute_competitor_table,
  compute_market_metrics,
)
from lib.db import WriteSession, get_client, upsert_rows  # noqa: E402
from lib.nhtsa_client import fetch_safety  # noqa: E402
from lib.outlook_prompt import SYSTEM_PROMPT, build_digest  # noqa: E402
from lib.perplexity_client import build_model_queries, search  # noqa: E402

ANTHROPIC_MODEL = os.environ.get('OEM_MODEL_OUTLOOK_MODEL', 'claude-sonnet-5')
KST = timezone(timedelta(hours=9))
METRIC_MONTHS = 12
MODEL_YEARS = [2026, 2025, 2024]

# 차종 메타 (표시명, OEM 그룹, Cox 브랜드, region).
# 경쟁군·시장은 DB(oem_competitor_set)가 정본이라 여기 두지 않는다.
#
# region 은 기존 행과 값 체계를 맞춘다('North America' | 'Global') — 시장 코드(USA/India/…)를
# 넣으면 같은 컬럼에 두 체계가 섞인다. 시장별 세부는 market_breakdown 이 담당한다.
# Cox 브랜드가 None 인 둘: rivian_r1 은 Cox 로스터에 Rivian 이 없고, avante_china 는 미국 미판매.
MODEL_META = {
  'grand_cherokee': ('Jeep Grand Cherokee', 'Stellantis', 'Jeep', 'North America'),
  'ram_truck': ('Ram Pickup (1500/2500/3500)', 'Stellantis', 'Ram', 'North America'),
  'pacifica': ('Chrysler Pacifica', 'Stellantis', 'Chrysler', 'North America'),
  'rivian_r1': ('Rivian R1T / R1S', 'Rivian', None, 'North America'),
  'atlas': ('Volkswagen Atlas', 'Volkswagen', 'Volkswagen', 'North America'),
  'porsche_911': ('Porsche 911', 'VW Group (Porsche)', 'Porsche', 'Global'),
  'seltos': ('Kia Seltos (셀토스)', 'Hyundai Kia', 'Kia', 'Global'),
  'avante_ex_china': ('Hyundai Avante/Elantra (중국 외)', 'Hyundai Kia', 'Hyundai', 'Global'),
  'avante_china': ('Hyundai Avante/Elantra (중국)', 'Hyundai Kia', None, 'Global'),
  'niro': ('Kia Niro (니로)', 'Hyundai Kia', 'Kia', 'Global'),
}

RESPONSE_SCHEMA = {
  'type': 'object',
  'properties': {
    'label': {'type': 'string', 'enum': ['GREEN', 'YELLOW', 'RED']},
    'sales_trend': {'type': 'string'},
    'competitive_view': {'type': 'string'},
    'consumer_view': {'type': 'string'},
    'outlook': {'type': 'string'},
    'rationale': {'type': 'string'},
    'market_comments': {
      'type': 'array',
      'items': {
        'type': 'object',
        'properties': {'market': {'type': 'string'}, 'comment': {'type': 'string'}},
        'required': ['market', 'comment'],
        'additionalProperties': False,
      },
    },
  },
  'required': ['label', 'sales_trend', 'competitive_view', 'consumer_view', 'outlook',
               'rationale', 'market_comments'],
  'additionalProperties': False,
}


def _fetch_model_rows(client, models: list[str], countries: list[str] | None) -> list[dict]:
  """지정 모델들의 월별 판매 행. countries=None 이면 전 국가 합산(GLOBAL).

  ⚠️ 'Europe' 같은 대륙 값은 country 컬럼에 존재하지 않는다 — 반드시 국가 배열을 넘긴다.
  """
  out: list[dict] = []
  frm = 0
  while True:
    q = (client.table('oem_sales_model_country_month')
         .select('model,country,year_month,sales')
         .in_('model', models)
         .order('oem_group').order('country').order('model').order('year_month'))
    if countries:
      q = q.in_('country', countries)
    rows = q.range(frm, frm + 999).execute().data or []
    out += rows
    if len(rows) < 1000:
      break
    frm += 1000
  return out


def _load_markets(client, model_key: str) -> list[dict]:
  """oem_competitor_set 기준으로 시장별 지표·경쟁표를 만든다."""
  sets = (client.table('oem_competitor_set').select('*')
          .eq('model_key', model_key).order('display_order').execute().data or [])
  markets = []
  for s in sets:
    countries = s.get('countries')  # NULL = 전 국가(GLOBAL). 'Europe' 은 국가 배열로 정의돼 있다
    target_rows = _fetch_model_rows(client, list(s['target_models']), countries)
    rival_rows = _fetch_model_rows(client, list(s['competitor_models']), countries)
    by_model: dict[str, list[dict]] = {}
    for r in rival_rows:
      by_model.setdefault(r['model'], []).append(r)
    markets.append({
      'market': s['market'],
      'label': s['market_label'],
      'metrics': compute_market_metrics(target_rows, rival_rows, months=METRIC_MONTHS),
      'competitors': compute_competitor_table(by_model, months=METRIC_MONTHS),
      'segment_note': s.get('segment_note'),
    })
  return markets


def _load_inventory(client, brand: str | None) -> dict | None:
  if not brand:
    return None
  rows = (client.table('cox_brand_inventory').select('*')
          .eq('brand', brand).order('year_month', desc=True).limit(1).execute().data or [])
  if not rows:
    return None
  r = rows[0]
  return {'brand': brand, 'days_supply': r.get('days_supply'), 'year_month': r['year_month']}


def _evaluate(anthropic: Anthropic, model_name: str, digest: str) -> dict | None:
  try:
    msg = anthropic.messages.create(
      model=ANTHROPIC_MODEL,
      max_tokens=4000,
      thinking={'type': 'adaptive'},
      output_config={'effort': 'high', 'format': {'type': 'json_schema', 'schema': RESPONSE_SCHEMA}},
      system=SYSTEM_PROMPT,
      messages=[{'role': 'user', 'content':
                 f'아래 데이터를 근거로 {model_name} 의 경쟁 현황을 분석하세요.\n\n{digest}'}],
    )
  except Exception as e:
    logger.error(f'{model_name}: Claude 호출 실패 — {e}')
    return None
  text = next((b.text for b in msg.content if b.type == 'text'), '')
  try:
    return json.loads(text)
  except json.JSONDecodeError as e:
    logger.error(f'{model_name}: JSON 파싱 실패 — {e} / {text[:300]}')
    return None


def main() -> int:
  if not os.environ.get('ANTHROPIC_API_KEY'):
    logger.error('ANTHROPIC_API_KEY 미설정')
    return 1
  anthropic = Anthropic()
  client = get_client()
  today = datetime.now(KST).date().isoformat()

  rows = []
  for model_key, (model_name, oem_group, cox_brand, region) in MODEL_META.items():
    logger.info(f'{model_key} 시작')
    markets = _load_markets(client, model_key)
    if not markets:
      logger.warning(f'{model_key}: 경쟁군 정의 없음 — 스킵')
      continue

    competitor_names = [c['model'] for c in (markets[0].get('competitors') or [])][:3]
    web_results = []
    for q in build_model_queries(model_name, competitor_names):
      web_results += search(q, max_results=4, recency_days=120)

    safety = fetch_safety(model_key, years=MODEL_YEARS)
    inventory = _load_inventory(client, cox_brand)

    digest = build_digest(
      model_name=model_name, markets=markets, production_gap=None,
      safety=safety, inventory=inventory, web_results=web_results,
    )
    result = _evaluate(anthropic, model_name, digest)
    if not result:
      continue

    comments = {c['market']: c['comment'] for c in result.get('market_comments') or []}
    breakdown = [{
      'market': m['market'],
      'label': m['label'],
      'sales': m['metrics']['recent_sales'],
      'yoy_pct': m['metrics']['yoy_pct'],
      'share_pct': m['metrics']['share_pct'],
      'prev_share_pct': m['metrics']['prev_share_pct'],
      'comment': comments.get(m['market']) or comments.get(m['label']) or '',
    } for m in markets]

    rows.append({
      'model_key': model_key,
      'model_name': model_name,
      'oem_group': oem_group,
      'region': region,
      'note_date': today,
      'label': result['label'],
      'consumer_view': result['consumer_view'],
      'outlook': result['outlook'],
      'rationale': result['rationale'],
      'competitive_view': result['competitive_view'],
      'sales_trend': result['sales_trend'],
      'market_breakdown': breakdown,
      'metrics': {'markets': markets, 'safety': safety, 'inventory': inventory},
      'sources': web_results,
      'sources_used': f'perplexity×{len(web_results)} nhtsa={bool(safety)} cox={bool(inventory)}',
    })
    logger.success(f'{model_key}: {result["label"]}')

  if not rows:
    logger.error('적재할 행 없음')
    return 1
  with WriteSession():
    upsert_rows('oem_model_outlook', rows, conflict_cols='model_key,note_date')
  logger.success(f'{today} {len(rows)}건 적재 완료')
  return 0


if __name__ == '__main__':
  sys.exit(main())
```

`build_digest(production_gap=None)`은 의도된 값이다 — 생산-판매 갭은 1차 범위에서 제외했다(「2차 확장 항목」 참조). `build_digest`는 `production_gap`이 None 이면 해당 섹션을 통째로 생략하므로 그대로 두면 된다.

- [ ] **Step 6: 문법 검사**

Run: `scripts/venv/Scripts/python.exe -m py_compile scripts/collect_oem_model_outlook.py scripts/lib/outlook_prompt.py`
Expected: 출력 없음(성공)

- [ ] **Step 7: 1개 차종만 실행해 확인**

`MODEL_META`를 임시로 `grand_cherokee` 하나만 남기고 실행:
Run: `scripts/venv/Scripts/python.exe scripts/collect_oem_model_outlook.py`
Expected: `grand_cherokee: RED|YELLOW|GREEN` + `1건 적재 완료`. DB에서 `competitive_view`에 경쟁차 이름과 증감률이 실제로 들어갔는지 눈으로 확인.

- [ ] **Step 8: 전체 실행 후 결과 검수**

`MODEL_META` 복원 후 실행. 10건 모두 적재되고 `market_breakdown`이 셀토스 3개·아반떼(중국 외) 2개·니로 2개인지 확인.

- [ ] **Step 9: 커밋**

```bash
git add scripts/collect_oem_model_outlook.py scripts/lib/outlook_prompt.py scripts/lib/test_outlook_prompt.py
git commit -m "feat(oem): AI 차종 평가 v2 — 판매실적·경쟁군·웹검색·리콜 기반으로 재작성

입력이 모회사 주식 뉴스뿐이라 매주 같은 내용이 나오던 문제를 해결한다.
모델도 Haiku 4.5 → Sonnet 5 로 교체."
```

---

### Task 8: 조회 계층 + 타입

**Files:**
- Create: `lib/oem-competition/types.ts`
- Create: `lib/oem-competition/source.ts`
- Test: `lib/oem-competition/source.test.ts`

**Interfaces:**
- Consumes: Task 3의 `oem_model_outlook` v2 컬럼
- Produces: `getCompetitionOutlooks(): Promise<CompetitionOutlook[]>`, 타입 `CompetitionOutlook`·`MarketBreakdown`

- [ ] **Step 1: 타입 정의**

```typescript
// lib/oem-competition/types.ts

/** 시장별 분해 — oem_model_outlook.market_breakdown (JSONB) 페이로드. */
export interface MarketBreakdown {
  market: string;
  label: string;
  sales: number;
  yoy_pct: number | null;
  share_pct: number | null;
  prev_share_pct: number | null;
  comment: string;
}

/** Perplexity 출처 — oem_model_outlook.sources (JSONB) 페이로드. */
export interface OutlookSource {
  title: string;
  url: string;
  date: string;
}

export interface CompetitionOutlook {
  modelKey: string;
  modelName: string;
  oemGroup: string;
  noteDate: string;
  label: 'GREEN' | 'YELLOW' | 'RED';
  salesTrend: string | null;
  competitiveView: string | null;
  consumerView: string;
  outlook: string;
  rationale: string;
  markets: MarketBreakdown[];
  sources: OutlookSource[];
}
```

- [ ] **Step 2: 매핑 순수 함수의 실패 테스트 작성**

```typescript
// lib/oem-competition/source.test.ts
import { describe, expect, it } from 'vitest';
import { mapOutlookRow, pickLatestPerModel } from './source';

describe('mapOutlookRow', () => {
  it('JSONB 컬럼이 null 이어도 빈 배열로 안전하게 매핑된다', () => {
    const row = {
      model_key: 'grand_cherokee',
      model_name: 'Jeep Grand Cherokee',
      oem_group: 'Stellantis',
      note_date: '2026-08-17',
      label: 'RED',
      sales_trend: null,
      competitive_view: null,
      consumer_view: 'c',
      outlook: 'o',
      rationale: 'r',
      market_breakdown: null,
      sources: null,
    };
    const out = mapOutlookRow(row);
    expect(out.markets).toEqual([]);
    expect(out.sources).toEqual([]);
    expect(out.modelKey).toBe('grand_cherokee');
  });
});

describe('pickLatestPerModel', () => {
  it('차종별로 note_date 가 가장 최근인 행만 남긴다', () => {
    const rows = [
      { model_key: 'a', note_date: '2026-08-10' },
      { model_key: 'a', note_date: '2026-08-17' },
      { model_key: 'b', note_date: '2026-08-17' },
    ];
    const out = pickLatestPerModel(rows as never[]);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.model_key === 'a')?.note_date).toBe('2026-08-17');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run lib/oem-competition/source.test.ts`
Expected: FAIL — `Failed to resolve import './source'`

- [ ] **Step 4: 구현**

```typescript
// lib/oem-competition/source.ts
import 'server-only';
import { cacheTag } from 'next/cache';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import logger from '@/lib/logger';
import type { CompetitionOutlook, MarketBreakdown, OutlookSource } from './types';

type OutlookRow = {
  model_key: string;
  model_name: string;
  oem_group: string;
  note_date: string;
  label: string;
  sales_trend: string | null;
  competitive_view: string | null;
  consumer_view: string;
  outlook: string;
  rationale: string;
  market_breakdown: unknown;
  sources: unknown;
};

/** JSONB 컬럼은 null 이거나 형태가 어긋날 수 있으므로 배열이 아니면 버린다. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function mapOutlookRow(row: OutlookRow): CompetitionOutlook {
  return {
    modelKey: row.model_key,
    modelName: row.model_name,
    oemGroup: row.oem_group,
    noteDate: row.note_date,
    label: (row.label as CompetitionOutlook['label']) ?? 'YELLOW',
    salesTrend: row.sales_trend,
    competitiveView: row.competitive_view,
    consumerView: row.consumer_view,
    outlook: row.outlook,
    rationale: row.rationale,
    markets: asArray<MarketBreakdown>(row.market_breakdown),
    sources: asArray<OutlookSource>(row.sources),
  };
}

/** 차종별 최신 1건만 남긴다(테이블 PK 가 (model_key, note_date) 라 이력이 쌓인다). */
export function pickLatestPerModel<T extends { model_key: string; note_date: string }>(
  rows: T[]
): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const prev = latest.get(row.model_key);
    if (!prev || row.note_date > prev.note_date) latest.set(row.model_key, row);
  }
  return [...latest.values()];
}

/** `/oem/competition` 카드 데이터. 수집기가 revalidate 태그를 쳐서 갱신한다. */
export async function getCompetitionOutlooks(): Promise<CompetitionOutlook[]> {
  'use cache';
  cacheTag('oem_model_outlook');

  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase
    .from('oem_model_outlook')
    .select('*')
    .order('note_date', { ascending: false })
    .limit(200);

  if (error) {
    logger.error({ err: error }, 'oem_model_outlook 조회 실패');
    return [];
  }
  return pickLatestPerModel((data ?? []) as OutlookRow[]).map(mapOutlookRow);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run lib/oem-competition/source.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 6: 커밋**

```bash
git add lib/oem-competition/
git commit -m "feat(oem): 경쟁 분석 조회 계층 추가"
```

---

### Task 9: `/oem/competition` 페이지 + 카드

**Files:**
- Create: `app/oem/competition/page.tsx`
- Create: `components/oem/CompetitionCards.tsx`
- Modify: `app/oem/layout.tsx` (탭 추가)
- Modify: `components/oem/OemDashboard.tsx:187-192,209-214` (기존 AI 평가 섹션 2개 제거)

**Interfaces:**
- Consumes: Task 8의 `getCompetitionOutlooks()`, `CompetitionOutlook`

- [ ] **Step 1: 카드 컴포넌트 작성**

```tsx
// components/oem/CompetitionCards.tsx
'use client';

import type { CompetitionOutlook, MarketBreakdown } from '@/lib/oem-competition/types';

const LABEL_STYLES: Record<CompetitionOutlook['label'], { bg: string; dot: string; text: string }> = {
  GREEN: {
    bg: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900',
    dot: 'bg-green-500',
    text: 'text-green-700 dark:text-green-300',
  },
  YELLOW: {
    bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900',
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
  },
  RED: {
    bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900',
    dot: 'bg-red-500',
    text: 'text-red-700 dark:text-red-300',
  },
};

function fmtPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function MarketRow({ market }: { market: MarketBreakdown }) {
  return (
    <div className="border-t border-border/50 pt-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-sm">{market.label}</span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {market.sales.toLocaleString()}대 · YoY {fmtPct(market.yoy_pct)}
          {market.share_pct !== null && (
            <> · 점유 {market.share_pct}%{market.prev_share_pct !== null && ` (전년 ${market.prev_share_pct}%)`}</>
          )}
        </span>
      </div>
      {market.comment && <p className="text-sm leading-relaxed mt-1">{market.comment}</p>}
    </div>
  );
}

export default function CompetitionCards({ outlooks }: { outlooks: CompetitionOutlook[] }) {
  if (outlooks.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        분석 데이터 없음. <code>scripts/collect_oem_model_outlook.py</code> 실행이 필요합니다.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {outlooks.map((o) => {
        const style = LABEL_STYLES[o.label] ?? LABEL_STYLES.YELLOW;
        return (
          <div key={o.modelKey} className={`rounded-md border p-4 ${style.bg}`}>
            <div className="flex items-center justify-between mb-1">
              <div className="font-semibold text-base">{o.modelName}</div>
              <div className="flex items-center gap-1.5">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${style.dot}`} />
                <span className={`text-sm font-medium ${style.text}`}>{o.label}</span>
              </div>
            </div>
            <div className="text-sm text-muted-foreground mb-3">
              {o.oemGroup} · {o.noteDate}
            </div>

            <div className="space-y-3 text-sm">
              {o.markets.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground font-medium">시장별 현황</div>
                  {o.markets.map((m) => (
                    <MarketRow key={m.market} market={m} />
                  ))}
                </div>
              )}

              {o.competitiveView && (
                <div>
                  <div className="text-sm text-muted-foreground font-medium mb-1">경쟁 현황</div>
                  <p className="leading-relaxed">{o.competitiveView}</p>
                </div>
              )}

              <div>
                <div className="text-sm text-muted-foreground font-medium mb-1">소비자 평가</div>
                <p className="leading-relaxed">{o.consumerView}</p>
              </div>

              <div>
                <div className="text-sm text-muted-foreground font-medium mb-1">판매 전망</div>
                <p className="leading-relaxed">{o.outlook}</p>
              </div>

              <div className="pt-2 border-t border-border/50">
                <p className="text-sm text-muted-foreground italic leading-relaxed">{o.rationale}</p>
              </div>

              {o.sources.length > 0 && (
                <details className="pt-1">
                  <summary className="text-sm text-muted-foreground cursor-pointer">
                    출처 {o.sources.length}건
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {o.sources.slice(0, 8).map((s) => (
                      <li key={s.url} className="text-sm">
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:underline"
                        >
                          [{s.date || '-'}] {s.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 페이지 작성**

```tsx
// app/oem/competition/page.tsx
import CompetitionCards from '@/components/oem/CompetitionCards';
import { getCompetitionOutlooks } from '@/lib/oem-competition/source';

export const metadata = { title: '차종 경쟁 분석' };

export default async function CompetitionPage() {
  const outlooks = await getCompetitionOutlooks();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">핵심 차종 경쟁 분석</h2>
        <p className="text-sm text-muted-foreground mt-1">
          MarkLines 판매 실적 + 지역별 경쟁차종 비교 + 웹 검색(신형 출시·소비자 반응) + NHTSA
          리콜을 근거로 Claude Sonnet 5 가 종합 · 매주 월요일 자동 갱신
        </p>
      </div>
      <CompetitionCards outlooks={outlooks} />
    </div>
  );
}
```

- [ ] **Step 3: `app/oem/layout.tsx:7-14` 탭 배열에 한 줄 추가**

`OEM_TABS`는 `{ label, href }` 순서의 `as const` 배열이다. "전체" 바로 뒤에 넣는다:

```typescript
const OEM_TABS = [
  { label: '전체', href: '/oem' },
  { label: '경쟁 분석', href: '/oem/competition' },
  { label: 'Stellantis USA', href: '/oem/stellantis-na' },
  { label: 'KG모빌리티', href: '/oem/kg-mobility' },
  { label: '현대차', href: '/oem/hyundai' },
  { label: '기아', href: '/oem/kia' },
  { label: '우즈베키스탄', href: '/oem/uzbekistan' },
] as const;
```

active 판정 로직은 그대로 둔다 — `/oem`은 정확히 일치할 때만 active이므로 `/oem/competition`이 새 탭을 올바르게 활성화한다.

- [ ] **Step 4: 기존 AI 평가 노출 경로 제거**

경쟁 분석 페이지로 이관됐으므로 중복 노출을 없앤다. **`lib/oem/source.ts`부터** 정리한다(여기서 데이터를 만들어 넘기고 있다):

1. `lib/oem/source.ts` — `fetchLatestOutlooks()` 함수(186행 부근), `OTHER_OUTLOOK_KEYS` 상수, `OemModelOutlook` import, 그리고 `Promise.all` 배열(243행 부근)의 `fetchLatestOutlooks(supabase)` 호출과 반환 객체의 `naOutlooks`·`otherOutlooks`(260~273행 부근)를 제거한다.
2. `components/oem/OemDashboard.tsx` — `ModelOutlookCards` import(14행), Props 타입의 `naOutlooks`·`otherOutlooks`, 그리고 아래 두 Section 블록을 제거:
   - `187-192`: "북미 핵심 차종 — AI 시장 평가"
   - `209-214`: "기타 핵심 차종 — AI 시장 평가"
3. `components/oem/ModelOutlookCards.tsx` — 위 제거 후 참조가 0이면 파일 삭제.
4. `app/oem/page.tsx` — `OemDashboard`에 outlook props를 넘기는 코드가 있으면 함께 제거.

제거 누락은 `npm run typecheck`가 잡는다(사용하지 않는 props는 타입 에러로 드러난다).

- [ ] **Step 5: 정적 검사**

Run: `npm run check-all`
Expected: lint·format·typecheck·test 전부 통과. 실패 시 미사용 import 잔재부터 확인.

- [ ] **Step 6: dev 서버로 눈으로 확인**

Run: `npm run dev` (⚠️ `pnpm run dev` 금지 — `ERR_PNPM_IGNORED_BUILDS`로 dev 가 안 뜬다. 포트는 3001+ 자동 배정)
확인:
1. `/oem/competition` 접속 → 카드 10장, 셀토스 카드에 인도·미국·한국 3줄이 보이는지
2. `/oem` 메인에서 기존 AI 평가 섹션이 사라졌는지
3. 브라우저 콘솔·네트워크 에러 없는지

- [ ] **Step 7: 커밋**

```bash
git add app/oem/competition components/oem/CompetitionCards.tsx app/oem/layout.tsx components/oem/OemDashboard.tsx lib/oem/source.ts
git rm components/oem/ModelOutlookCards.tsx   # 참조가 0일 때만 (--cached 아님: 파일도 지운다)
git commit -m "feat(oem): /oem/competition 경쟁 분석 페이지 신설

기존 /oem 메인의 AI 평가 카드 2개 섹션을 이 페이지로 이관한다."
```

---

### Task 10: 워크플로 · 문서 갱신

**Files:**
- Modify: `.github/workflows/collect-oem-model-outlook.yml`
- Modify: `AGENTS.md`, `Architecture.md`, `docs/oem-collection.md`, `ROADMAP.md`, `HANDOFF.md`

- [ ] **Step 1: 워크플로 주기 변경 + 시크릿 추가**

`.github/workflows/collect-oem-model-outlook.yml`에서 세 곳을 고친다:

```yaml
name: 핵심 차종 경쟁 분석 수집 (월 1회)

on:
  schedule:
    - cron: '30 21 20 * *' # KST 매월 21일 06:30 (UTC 20일 21:30)
  workflow_dispatch:
```
그리고 `env:` 블록에 한 줄 추가:
```yaml
          PERPLEXITY_API_KEY: ${{ secrets.PERPLEXITY_API_KEY }}
```

기존 cron 은 `'30 21 * * 0'`(주 1회 일요일)이었다. 월 1회로 바꾸는 근거는 문서 상단 「운영 비용 · 수집 주기」 참조.

⚠️ **GitHub 저장소 Settings → Secrets 에 `PERPLEXITY_API_KEY` 를 등록해야 한다**(웹에서 사람이 직접). 등록 전에는 웹 검색이 조용히 건너뛰어지고 분석 품질이 떨어진다.

- [ ] **Step 2: 워크플로 수동 실행 검증**

Run:
```powershell
gh workflow run collect-oem-model-outlook.yml --ref master
gh run watch <run-id> --exit-status
```
Expected: 성공. 실패 시 `gh run view <id> --log`로 확인하되 **tail 로 읽지 말 것**(무해한 메시지가 끝에 몰린다).

- [ ] **Step 3: 문서 갱신**

| 문서 | 갱신 내용 |
|---|---|
| `AGENTS.md` | 라우트 표에 `/oem/competition` 행 추가 · `scripts/lib` 공용 모듈 목록에 `perplexity_client.py`·`nhtsa_client.py`·`competition_metrics.py`·`model_segment.py`·`outlook_prompt.py` 추가 · `lib/oem-competition/` 도메인 폴더 추가 |
| `Architecture.md` | §7 에 `oem_model_segment`·`oem_competitor_set` 테이블, `oem_model_outlook` v2 컬럼 추가 · §5 라우트 목록 · §10 워크플로 설명 갱신 |
| `docs/oem-collection.md` | 경쟁 분석 수집 흐름(경쟁군 SSOT·Perplexity·NHTSA·Cox 제약) 절 추가 |
| `docs/gotchas-data-collection.md` | **생산/판매 `country` 의미 정반대**, **Cox 에 Rivian 없음**, **NHTSA 모델연도 폴백 필요**, **`'N/A'` 모델 제외** 4건 추가 |
| `ROADMAP.md` | 해당 Phase 진행 반영 |
| `HANDOFF.md` | 새 `## 최신 상태 · 재개 지점` 블록을 맨 위에 추가, 직전 블록은 `## 이전 상태 …`로 강등 |

- [ ] **Step 4: 문서 검사 스크립트 실행**

Run: `scripts/venv/Scripts/python.exe scripts/verify_docs.py`
Expected: 통과(표 구조·상대 링크·자동 로드 분량)

- [ ] **Step 5: 최종 검증**

Run:
```powershell
npm run check-all
scripts/venv/Scripts/python.exe -m pytest scripts/lib -q
```
Expected: 둘 다 통과

- [ ] **Step 6: 커밋**

```bash
git add .github/workflows/collect-oem-model-outlook.yml AGENTS.md Architecture.md docs/ ROADMAP.md HANDOFF.md
git commit -m "docs(oem): 경쟁 분석 파이프라인 문서화 + 워크플로 시크릿 추가"
```

---

## 미해결 가정 (실행 전 확인 필요)

1. **10개 차종이 우리 공급 차종인지 미확인.** 사용자가 "지금 10개를 기준으로"라고만 답해 선정 근거는 확인되지 않았다. 공급 차종이 아니라면 대상 재선정이 선행돼야 한다 — 다만 이 계획은 대상 목록에 의존하지 않으므로(`MODEL_META` + `oem_competitor_set` 두 곳만 고치면 된다) 나중에 바꿔도 구조는 그대로 쓴다.
2. **Perplexity `search_recency_filter` 파라미터명 미검증.** 검색 자체는 실호출로 확인했으나(HTTP 200, 5건, 2026-08-12 기사) 최신성 필터 파라미터는 문서 확인 없이 추정했다. Task 4 Step 5 스모크에서 결과가 비거나 400이 뜨면 이 파라미터를 빼고 검색어에 연도를 넣는 방식으로 대체한다.
3. **`PERPLEXITY_API_KEY` GitHub Secrets 미등록.** 로컬(`scripts/.env`·`.env.local`)에는 등록돼 있으나 Actions 시크릿은 사람이 웹에서 넣어야 한다(Task 10 Step 1). 등록 전에는 웹 검색이 조용히 건너뛰어진다 — 실패가 아니라 **품질 저하로만** 나타나므로 놓치기 쉽다.
4. ~~생산-판매 갭 포함 여부 미정~~ → **1차 범위에서 제외 확정**(사용자 결정 2026-08-13). `compute_production_gap`을 아예 만들지 않고 `production_gap=None`을 유지한다. 코드는 아래 「2차 확장 항목」에 보존.
5. **Cox 재고일수의 브랜드 단위 한계.** `MODEL_META`의 세 번째 값이 브랜드인데, 한 브랜드에 여러 차종이 있으면(Kia = seltos·niro) 같은 수치가 두 카드에 쓰인다. 차종별 재고가 아니라 **브랜드 재고**임을 카드 문구에 명시해야 오해가 없다.

---

## 2차 확장 항목 (1차 범위 밖 — 착수 금지)

1차가 안정된 뒤 별도 계획으로 진행한다. 여기 적힌 코드는 그때 옮겨 쓰기 위한 보존본이며, **1차 실행 중에는 만들지 않는다.**

### 생산-판매 갭 (재고 압박 선행 신호)

`scripts/lib/competition_metrics.py`에 추가할 함수:

```python
def compute_production_gap(sales_rows: list[dict], production_rows: list[dict]) -> dict:
  """생산-판매 갭 — 반드시 글로벌 합계로만.

  ⚠️ oem_production_*.country 는 공장 국가, oem_sales_*.country 는 판매 시장이라
  국가별로 차감하면 수출입이 섞여 무의미해진다(Architecture.md:348).
  """
  s = _sum(sales_rows, 'sales')
  p = _sum(production_rows, 'production')
  return {
    'sales_total': s,
    'production_total': p,
    'gap': p - s,
    'is_approximate': True,
    'note': '생산은 공장 국가, 판매는 판매 시장 기준이라 글로벌 합계 근사치',
  }
```

수집기 배선(`safety = ...` 앞):

```python
    all_targets = sorted({m for s in markets for m in s.get('target_models', [])})
    sales_all = _fetch_model_rows(client, all_targets, None)
    prod_all = (client.table('oem_production_model_country_month')
                .select('year_month,production,country')
                .in_('model', all_targets)
                .order('oem_group').order('country').order('model').order('year_month')
                .limit(2000).execute().data or [])
    production_gap = compute_production_gap(sales_all, prod_all)
```

`_load_markets()`의 `markets.append({...})`에 `'target_models': list(s['target_models'])`를 추가해야 하고, 화면에 **"글로벌 합계 근사치"** 표기가 필수다.

### 그 밖의 후보

- **모델 라이프사이클 테이블** — Perplexity 검색으로 풀체인지·페이스리프트가 상당 부분 커버되는지 1차 운영 결과를 보고 판단. 필요하면 `model_lifecycle` 수동 테이블 + 파생 지표 "모델 나이(마지막 풀체인지 이후 개월)".
- **가격·인센티브 동향** — 미국은 차종별 인센티브가 공개된다. 판매를 할인으로 산 것인지 판별하는 데 쓴다.
- **파워트레인 믹스 변화** — Task 1의 `oem_model_segment.powertrains`를 활용한 전동화 전환 속도.
