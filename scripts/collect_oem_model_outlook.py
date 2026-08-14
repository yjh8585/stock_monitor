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

일부 차종만 다시 채우려면 `--only` 를 쓴다(전체 재실행은 멀쩡한 차종까지 덮어쓴다):
  python collect_oem_model_outlook.py --only ram_truck
  python collect_oem_model_outlook.py --only ram_truck niro
"""
import argparse
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
from lib.nhtsa_client import fetch_competitor_safety, fetch_safety  # noqa: E402
from lib.outlook_prompt import SYSTEM_PROMPT, build_digest  # noqa: E402
from lib.perplexity_client import build_model_queries, search  # noqa: E402

ANTHROPIC_MODEL = os.environ.get('OEM_MODEL_OUTLOOK_MODEL', 'claude-sonnet-5')
KST = timezone(timedelta(hours=9))
METRIC_MONTHS = 12
MODEL_YEARS = [2026, 2025, 2024]
# Cox 유통재고·NHTSA 는 미국 데이터라 이 시장에만 붙인다(GLOBAL 은 참고치로 싣고 화면이 등급을
# 매기지 않는다). 🔴 `lib/oem-competition/source.ts` 의 US_BASED_MARKETS 와 같은 값이어야 한다.
US_BASED_MARKETS = {'USA', 'GLOBAL'}
# 시장별로 경쟁 지표(재고일수·리콜·소비자 점수)를 붙일 경쟁 차종 수. 판매 상위부터.
# 전부 붙이면 레이더·막대가 읽히지 않고 NHTSA 호출 수도 폭증한다.
TOP_RIVALS = 3

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
    'sales_trend': {
      'type': 'string',
      'description': '차종 전체의 판매 흐름. 시장이 여럿이면 시장 간 대조·엇갈림을 쓴다. '
                     '단일 시장이면 월별 흐름·추세 전환처럼 market_comments 에 없는 각도로 쓴다.',
    },
    'competitive_view': {'type': 'string'},
    'consumer_view': {'type': 'string'},
    'outlook': {'type': 'string'},
    'rationale': {'type': 'string'},
    'market_comments': {
      'type': 'array',
      'items': {
        'type': 'object',
        'properties': {
          'market': {'type': 'string'},
          'comment': {
            'type': 'string',
            'description': '그 시장 하나에 국한된 해설. 다른 시장이나 차종 전체 흐름은 쓰지 않는다.',
          },
        },
        'required': ['market', 'comment'],
        'additionalProperties': False,
      },
    },
    # 화면의 레이더 차트 입력. 서술(consumer_view)만으로는 "경쟁 대비 어디가 낫고 어디가
    # 밀리는지"가 한눈에 안 잡혀 5축 점수로도 받는다.
    'consumer_scores': {
      'type': 'array',
      'description': '시장별 소비자 평가 점수. 각 시장마다 대상 차종 1개 + 그 시장 판매 상위 '
                     '경쟁차종 3개를 채점한다(경쟁차종이 3개 미만이면 있는 만큼).',
      'items': {
        'type': 'object',
        'properties': {
          'market': {'type': 'string', 'description': '시장 코드(USA/India/Korea/China/Europe/GLOBAL)'},
          'scores': {
            'type': 'array',
            'items': {
              'type': 'object',
              'properties': {
                'model': {'type': 'string', 'description': '입력 데이터의 차종 표기 그대로'},
                'is_target': {'type': 'boolean'},
                'design': {'type': 'integer', 'description': '상품성·디자인 (1~5)'},
                'price': {'type': 'integer', 'description': '가격 경쟁력 (1~5)'},
                'quality': {'type': 'integer', 'description': '품질·신뢰도 (1~5)'},
                'efficiency': {'type': 'integer', 'description': '연비·전동화 (1~5)'},
                'brand': {'type': 'integer', 'description': '브랜드·잔존가치 (1~5)'},
              },
              'required': ['model', 'is_target', 'design', 'price', 'quality', 'efficiency',
                           'brand'],
              'additionalProperties': False,
            },
          },
        },
        'required': ['market', 'scores'],
        'additionalProperties': False,
      },
    },
    # 신차 사이클(화면의 노후도 비교 차트 입력).
    #
    # 🔴 대상 차종만 받으면 쓸모가 없다. "판매가 왜 빠지나"에 대한 답이 노후화인지 아닌지는
    # **경쟁 차종의 연식과 나란히 놓아야만** 판정된다(사용자 지시 2026-08-14: "경쟁 차종이랑
    # 비교해서 보여줘. 그랜드체로키가 하락하는 건 경쟁 대비 노후화 때문이다, 라는 걸 확인할 수
    # 있게"). 그래서 consumer_scores 와 같은 [시장 × (대상+상위 3종)] 구조로 받는다.
    'model_cycle': {
      'type': 'array',
      'description': '시장별 신차 사이클. 각 시장마다 대상 차종 1개 + 그 시장 판매 상위 경쟁차종 '
                     '3개(있는 만큼)의 세대 연식을 채운다.',
      'items': {
        'type': 'object',
        'properties': {
          'market': {'type': 'string', 'description': '시장 코드(USA/India/Korea/China/Europe/GLOBAL)'},
          'models': {
            'type': 'array',
            'items': {
              'type': 'object',
              'properties': {
                'model': {'type': 'string', 'description': '입력 데이터의 차종 표기 그대로'},
                'is_target': {'type': 'boolean'},
                'last_full_change': {
                  'type': 'integer',
                  'description': '현행 세대가 처음 나온 연식(완전변경/풀체인지). 연식 기준 4자리 '
                                 '연도. 확실치 않으면 가장 널리 알려진 값을 쓴다.',
                },
                'last_update': {
                  'type': 'integer',
                  'description': '마지막으로 상품성이 개선된 연식(페이스리프트·대규모 연식변경). '
                                 '완전변경 이후 개선이 없었으면 last_full_change 와 같은 값.',
                },
                'last_update_type': {
                  'type': 'string',
                  'enum': ['완전변경', '페이스리프트', '연식변경'],
                  'description': 'last_update 가 무엇이었는지.',
                },
                'next_event_type': {
                  'type': 'string',
                  'enum': ['완전변경', '페이스리프트', '연식변경', '미정'],
                  'description': '다음 예정된 변화. 근거가 없으면 "미정".',
                },
                'next_event_timing': {
                  'type': 'string',
                  'description': '다음 변화 시점("2026년 가을", "2027년형"). 모르면 빈 문자열.',
                },
                'note': {
                  'type': 'string',
                  'description': '한 줄 부연(플랫폼·파워트레인 변화 등). 없으면 빈 문자열.',
                },
              },
              'required': ['model', 'is_target', 'last_full_change', 'last_update',
                           'last_update_type', 'next_event_type', 'next_event_timing', 'note'],
              'additionalProperties': False,
            },
          },
        },
        'required': ['market', 'models'],
        'additionalProperties': False,
      },
    },
  },
  'required': ['label', 'sales_trend', 'competitive_view', 'consumer_view', 'outlook',
               'rationale', 'market_comments', 'consumer_scores', 'model_cycle'],
  'additionalProperties': False,
}

# 레이더 축 정의 — 화면(lib/oem-competition/types.ts CONSUMER_AXES)과 키가 일치해야 한다.
CONSUMER_AXIS_KEYS = ('design', 'price', 'quality', 'efficiency', 'brand')


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
  """oem_competitor_set 기준으로 시장별 지표·경쟁표를 만든다.

  ⚠️ compute_market_metrics 가 돌려주는 anchor_month(대상·경쟁군 최신월 중 이른 쪽)를
  compute_competitor_table 에 그대로 넘긴다 — 안 넘기면 대상 차종과 경쟁 차종이 서로
  다른 기간으로 비교돼 점유율이 조용히 왜곡된다(Task 6 리뷰에서 잡힌 문제).
  """
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
    metrics = compute_market_metrics(target_rows, rival_rows, months=METRIC_MONTHS)
    markets.append({
      'market': s['market'],
      'label': s['market_label'],
      'metrics': metrics,
      'competitors': compute_competitor_table(
        by_model, months=METRIC_MONTHS, anchor=metrics['anchor_month']),
      'segment_note': s.get('segment_note'),
    })
  return markets


def _load_inventory_by_brand(client, brands: list[str]) -> dict[str, dict]:
  """브랜드별 **최신 non-null** 재고일수 + 이상치 제외 여부.

  🔴 `order(desc).limit(1)` 로 최신 1행만 집으면 안 된다 — Cox 는 값이 업계평균을 크게 벗어나면
  그 달을 비워 둔다. 실측(2026-08-13): Ram 202606=NULL 이지만 202605=144 가 있는데도 최신
  1행만 보던 옛 구현이 "재고 데이터 없음"으로 저장하고 있었다.

  🔴 그런데 non-null 만 집으면 **정반대 방향의 오독**이 생긴다(사용자 지적 2026-08-14): 값이 빈
  달은 "모르는 달"이 아니라 업계 평균의 2배를 넘어 Cox 가 감춘 달이다. 그대로 넘기면 AI 프롬프트에
  직전 달의 멀쩡한 값만 들어가 "재고 평이" 라는 서술이 나온다 — 실제로는 가장 심각한 상태다.
  그래서 `is_outlier_excluded` 를 함께 실어 최신월이 감춰졌는지 알린다.
  """
  brands = sorted({b for b in brands if b})
  if not brands:
    return {}
  rows = (client.table('cox_brand_inventory')
          .select('brand,year_month,days_supply,is_outlier_excluded')
          .in_('brand', brands).order('year_month', desc=True).execute().data or [])
  # 이상치 판정은 Cox **전체의 최신 집계월** 기준이다. 브랜드 자신의 마지막 행으로 판정하면 그 달
  # 로스터에서 통째로 빠진 브랜드(Lincoln 202601 등)까지 이상치로 몰아 없는 사실을 만든다.
  latest_month = max((r['year_month'] for r in rows), default=0)

  out: dict[str, dict] = {}
  for r in rows:  # year_month 내림차순
    brand = r['brand']
    entry = out.setdefault(brand, {'brand': brand, 'days_supply': None, 'year_month': None,
                                   'outlier_excluded': False, 'outlier_month': None})
    if r['year_month'] == latest_month and r.get('is_outlier_excluded'):
      entry['outlier_excluded'] = True
      entry['outlier_month'] = latest_month
    if entry['days_supply'] is None and r['days_supply'] is not None:
      entry['days_supply'] = r['days_supply']
      entry['year_month'] = r['year_month']
  # 값이 한 번도 공개된 적 없는 브랜드는 비교에 못 쓴다(로스터 밖 브랜드와 구분되지 않는다).
  return {b: e for b, e in out.items() if e['days_supply'] is not None}


def _load_model_brands(client, models: list[str]) -> dict[str, str]:
  """MarkLines 모델명 → Cox 브랜드(oem_model_brand). 미등록 모델은 결과에 없다.

  🔴 `cox_brand` 는 2026-08-14 부터 **nullable** 이다 — 화면 표기용 브랜드(`display_brand`)를
  채우면서 미국 미판매 차종(Brezza·Nexon·Qin PLUS 등) 행이 들어왔고, 그 행들은 Cox 로스터에
  없어 `cox_brand` 가 NULL 이다. 걸러 내지 않으면 `_load_inventory_by_brand` 의 `.in_()` 에
  None 이 섞인다.
  """
  models = sorted({m for m in models if m})
  if not models:
    return {}
  rows = (client.table('oem_model_brand').select('model,cox_brand')
          .in_('model', models).execute().data or [])
  return {r['model']: r['cox_brand'] for r in rows if r.get('cox_brand')}


def _top_rivals(market: dict) -> list[str]:
  """그 시장 판매 상위 경쟁 차종 이름(compute_competitor_table 이 이미 내림차순 정렬)."""
  return [c['model'] for c in (market.get('competitors') or [])][:TOP_RIVALS]


def _load_competitor_context(client, markets: list[dict],
                             safety_cache: dict[str, dict | None]) -> tuple[list[dict], list[dict]]:
  """시장별 상위 경쟁 차종의 재고일수·리콜.

  같은 경쟁 차종이 여러 시장·여러 대상 차종에 걸쳐 나오므로 NHTSA 결과는 caller 가 넘긴
  캐시에 모아 재조회를 막는다(호출 수가 배로 뛴다).

  🔴 **미국 기준 시장에만 붙인다.** Cox·NHTSA 는 미국 데이터인데, 경쟁 차종 매핑(oem_model_brand)
  은 시장을 모른다 — 셀토스 한국 경쟁군의 Kona·Trailblazer 는 미국에서도 팔려 매핑이 있으므로
  거르지 않으면 **한국 시장 블록에 미국 재고·리콜이 실린다**(2026-08-14 실측으로 확인). 화면은
  `source.ts` 의 US_BASED_MARKETS 로 한 번 더 거르지만, 여기서 막지 않으면 그 값이 AI 프롬프트에
  들어가 "한국 시장 재고 74일" 같은 서술을 만든다. 걸러 두면 NHTSA 호출 수도 함께 준다.
  """
  us_markets = [mk for mk in markets if mk['market'] in US_BASED_MARKETS]
  wanted = sorted({m for mk in us_markets for m in _top_rivals(mk)})
  brand_of = _load_model_brands(client, wanted)
  inv_of = _load_inventory_by_brand(client, list(brand_of.values()))

  inventory_out, safety_out = [], []
  for mk in us_markets:
    rivals = _top_rivals(mk)
    inv_rows = []
    for name in rivals:
      brand = brand_of.get(name)
      inv = inv_of.get(brand) if brand else None
      if inv:
        inv_rows.append({'model': name, **inv})
    saf_rows = []
    for name in rivals:
      if name not in safety_cache:
        safety_cache[name] = fetch_competitor_safety(name, years=MODEL_YEARS)
      s = safety_cache[name]
      if s:
        saf_rows.append({'model': name, 'model_year': s['model_year'],
                         'recall_count': s['recalls']['count'],
                         'complaint_count': s['complaint_count']})
    if inv_rows:
      inventory_out.append({'market': mk['market'], 'models': inv_rows})
    if saf_rows:
      safety_out.append({'market': mk['market'], 'models': saf_rows})
  return inventory_out, safety_out


def _normalize_consumer_scores(raw: object, markets: list[dict]) -> list[dict]:
  """AI 가 준 5축 점수를 화면이 믿고 쓸 수 있는 형태로 정리한다.

  JSON Schema 로는 값 범위를 강제하지 않았으므로(모델별 지원 편차) 여기서 1~5 로 자른다.
  정의에 없는 시장, 축이 빠진 항목, 대상 차종이 없는 시장은 버린다 — 레이더 차트는 대상과
  경쟁을 겹쳐 그리는 것이 전부라 대상이 빠지면 의미가 없다.
  """
  known = {m['market'] for m in markets}
  out = []
  for block in raw if isinstance(raw, list) else []:
    if not isinstance(block, dict) or block.get('market') not in known:
      continue
    rows = []
    for s in block.get('scores') or []:
      if not isinstance(s, dict) or not s.get('model'):
        continue
      if any(not isinstance(s.get(k), int) for k in CONSUMER_AXIS_KEYS):
        continue
      rows.append({
        'model': str(s['model']),
        'is_target': bool(s.get('is_target')),
        **{k: max(1, min(5, int(s[k]))) for k in CONSUMER_AXIS_KEYS},
      })
    if any(r['is_target'] for r in rows) and len(rows) >= 2:
      out.append({'market': block['market'], 'scores': rows})
  return out


# 연식은 4자리 연도다. 범위를 벗어난 값(오타·환각)은 차트 축을 통째로 망가뜨리므로 버린다.
# 하한은 현행 세대가 남아 있을 수 있는 최대치, 상한은 선행 출시 연식(현재+2년)을 감안한 값.
_CYCLE_YEAR_MIN, _CYCLE_YEAR_MAX = 1990, 2100


def _normalize_model_cycle(raw: object, markets: list[dict]) -> list[dict]:
  """AI 가 준 신차 사이클을 화면이 믿고 쓸 수 있는 형태로 정리한다.

  🔴 **경쟁 차종이 하나도 없는 시장은 버린다.** 이 표의 목적은 "대상이 경쟁 대비 노후한가"라서
  대상 혼자 남으면 비교가 성립하지 않는다(연식 하나만 덩그러니 보여 주면 오히려 오독을 부른다).
  """
  known = {m['market'] for m in markets}
  out = []
  for block in raw if isinstance(raw, list) else []:
    if not isinstance(block, dict) or block.get('market') not in known:
      continue
    rows = []
    for m in block.get('models') or []:
      if not isinstance(m, dict) or not m.get('model'):
        continue
      full = m.get('last_full_change')
      if not isinstance(full, int) or not _CYCLE_YEAR_MIN <= full <= _CYCLE_YEAR_MAX:
        continue
      upd = m.get('last_update')
      # 개선 연식이 없거나 완전변경보다 이르면(모순) 완전변경 연식으로 되돌린다.
      if not isinstance(upd, int) or not full <= upd <= _CYCLE_YEAR_MAX:
        upd = full
      rows.append({
        'model': str(m['model']),
        'is_target': bool(m.get('is_target')),
        'last_full_change': full,
        'last_update': upd,
        'last_update_type': str(m.get('last_update_type') or ''),
        'next_event_type': str(m.get('next_event_type') or ''),
        'next_event_timing': str(m.get('next_event_timing') or ''),
        'note': str(m.get('note') or ''),
      })
    if any(r['is_target'] for r in rows) and len(rows) >= 2:
      out.append({'market': block['market'], 'models': rows})
  return out


def _evaluate(anthropic: Anthropic, model_name: str, digest: str) -> dict | None:
  try:
    msg = anthropic.messages.create(
      model=ANTHROPIC_MODEL,
      # 🔴 max_tokens 는 사고+응답 합산 상한이다. adaptive thinking 이 대부분을 쓰므로
      # 4000 에서는 서술이 긴 차종(ram_truck = 1500/2500/3500 합산)이 JSON 중간에서 잘려
      # 파싱에 실패하고 그 차종만 조용히 빠졌다(워크플로는 success). 실제 과금은 사용량
      # 기준이라 상한을 올려도 안 쓰면 비용이 늘지 않는다.
      max_tokens=16000,
      thinking={'type': 'adaptive'},
      output_config={'effort': 'high', 'format': {'type': 'json_schema', 'schema': RESPONSE_SCHEMA}},
      system=SYSTEM_PROMPT,
      messages=[{'role': 'user', 'content':
                 f'아래 데이터를 근거로 {model_name} 의 경쟁 현황을 분석하세요.\n\n{digest}'}],
    )
  except Exception as e:
    logger.error(f'{model_name}: Claude 호출 실패 — {e}')
    return None
  if msg.stop_reason == 'max_tokens':
    logger.warning(f'{model_name}: 응답이 max_tokens 에서 잘림 — max_tokens 상향 검토 필요')
  text = next((b.text for b in msg.content if b.type == 'text'), '')
  try:
    return json.loads(text)
  except json.JSONDecodeError as e:
    logger.error(f'{model_name}: JSON 파싱 실패 — {e} / {text[:300]}')
    return None


def _parse_args() -> argparse.Namespace:
  p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  p.add_argument(
    '--only',
    nargs='+',
    metavar='MODEL_KEY',
    help='이 차종만 수집한다(생략 시 전체). 예: --only ram_truck',
  )
  return p.parse_args()


def _select_targets(only: list[str] | None) -> dict | None:
  """--only 로 대상을 좁힌다. 알 수 없는 키가 있으면 None(= 중단)."""
  if not only:
    return MODEL_META
  unknown = [k for k in only if k not in MODEL_META]
  if unknown:
    logger.error(f'알 수 없는 model_key: {unknown} — 가능한 값: {list(MODEL_META)}')
    return None
  # 중복 입력은 무시하되 사용자가 준 순서를 유지한다
  return {k: MODEL_META[k] for k in dict.fromkeys(only)}


def main() -> int:
  args = _parse_args()
  if not os.environ.get('ANTHROPIC_API_KEY'):
    logger.error('ANTHROPIC_API_KEY 미설정')
    return 1
  targets = _select_targets(args.only)
  if targets is None:
    return 1
  if args.only:
    logger.info(f'--only 지정 — {len(targets)}종만 수집: {list(targets)}')

  anthropic = Anthropic()
  client = get_client()
  today = datetime.now(KST).date().isoformat()

  rows = []
  safety_cache: dict[str, dict | None] = {}  # 경쟁 차종 NHTSA 결과 — 차종 간 재사용
  for model_key, (model_name, oem_group, cox_brand, region) in targets.items():
    logger.info(f'{model_key} 시작')
    markets = _load_markets(client, model_key)
    if not markets:
      logger.warning(f'{model_key}: 경쟁군 정의 없음 — 스킵')
      continue

    competitor_names = _top_rivals(markets[0])
    # 검색어 3종이 같은 차종을 겨냥하므로 같은 기사가 겹칠 수 있다. 중복을 남기면 카드의
    # "출처 N건" 이 부풀고 React key(url) 가 충돌한다.
    web_results, seen_urls = [], set()
    for q in build_model_queries(model_name, competitor_names):
      for r in search(q, max_results=4, recency_days=120):
        if r['url'] in seen_urls:
          continue
        seen_urls.add(r['url'])
        web_results.append(r)

    safety = fetch_safety(model_key, years=MODEL_YEARS)
    inventory = (_load_inventory_by_brand(client, [cox_brand]).get(cox_brand)
                 if cox_brand else None)
    rival_inventory, rival_safety = _load_competitor_context(client, markets, safety_cache)

    digest = build_digest(
      model_name=model_name, markets=markets, production_gap=None,
      safety=safety, inventory=inventory, web_results=web_results,
      rival_inventory=rival_inventory, rival_safety=rival_safety,
    )
    result = _evaluate(anthropic, model_name, digest)
    if not result:
      continue

    scores = _normalize_consumer_scores(result.get('consumer_scores'), markets)
    if len(scores) < len(markets):
      # 레이더가 빈 시장이 생긴다. 조용히 넘어가면 화면에서만 뒤늦게 드러난다.
      logger.warning(f'{model_key}: 소비자 점수 {len(scores)}/{len(markets)} 시장만 유효')

    cycle = _normalize_model_cycle(result.get('model_cycle'), markets)
    if len(cycle) < len(markets):
      logger.warning(f'{model_key}: 신차 사이클 {len(cycle)}/{len(markets)} 시장만 유효')

    comments = {c['market']: c['comment'] for c in result.get('market_comments') or []}
    breakdown = [{
      'market': m['market'],
      'label': m['label'],
      'sales': m['metrics']['recent_sales'],
      'yoy_pct': m['metrics']['yoy_pct'],
      'share_pct': m['metrics']['share_pct'],
      'prev_share_pct': m['metrics']['prev_share_pct'],
      # 판매량이 "언제 기준 몇 개월 누계"인지 — 없으면 화면에서 월간 실적으로 오해된다
      'anchor_month': m['metrics'].get('anchor_month'),
      'months': m['metrics'].get('months'),
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
      # 별도 컬럼인 이유: metrics 는 "수집한 사실"(판매·재고·리콜)이고 model_cycle 은
      # AI 판정이라 갱신 주기와 신뢰도가 다르다. 섞으면 어느 쪽이 근거인지 구분되지 않는다.
      'model_cycle': cycle,
      'metrics': {
        'markets': markets,
        'safety': safety,
        'inventory': inventory,
        'competitor_inventory': rival_inventory,
        'competitor_safety': rival_safety,
        'consumer_scores': scores,
      },
      # snippet 은 프롬프트 입력용이라 저장하지 않는다(화면은 title/url/date 만 쓴다)
      'sources': [{k: v for k, v in r.items() if k != 'snippet'} for r in web_results],
      'sources_used': f'perplexity×{len(web_results)} nhtsa={bool(safety)} cox={bool(inventory)}'
                      f' rivals(inv={len(rival_inventory)} saf={len(rival_safety)})'
                      f' scores={len(scores)} cycle={len(cycle)}',
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
