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
  if msg.stop_reason == 'max_tokens':
    logger.warning(f'{model_name}: 응답이 max_tokens 에서 잘림 — max_tokens 상향 검토 필요')
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
