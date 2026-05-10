"""
Anthropic Claude web_search tool로 영문 회사명을 직접 검색해 매출/영업이익을 추출한다.
collect_top100_fallback.py 가 IR/DDG 폴백으로 못 찾은 회사 (_top100_unresolved.json) 를 재시도.

흐름:
  1. _top100_unresolved.json 큐 읽기 (reason='all_fallback_failed' 등 모두)
  2. 회사별:
     a. Claude API + web_search + submit_financials tool_use
     b. 영문명·국가·연도 prompt → Claude가 알아서 검색·추출
     c. 응답값 검증 후 financials upsert
"""
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows  # noqa: E402

UNRESOLVED_PATH = Path(__file__).parent / '_top100_unresolved.json'
LOG_PATH = Path(__file__).parent / '_top100_websearch_log.json'

DEFAULT_MODEL = os.environ.get('MODEL', 'claude-haiku-4-5-20251001')

EXTRACT_TOOL = {
  'name': 'submit_financials',
  'description': (
    'Submit the latest available annual revenue (and other figures) for the company. '
    'Use the headquarters/global consolidated number, NOT a regional/segment subset.'
  ),
  'input_schema': {
    'type': 'object',
    'properties': {
      'fiscal_year': {'type': 'integer', 'description': 'Fiscal year (e.g. 2024).'},
      'revenue_amount': {'type': ['number', 'null']},
      'revenue_currency': {
        'type': ['string', 'null'],
        'description': 'ISO 4217 (USD/EUR/JPY/CNY/KRW/GBP/CAD/INR/MXN/CHF/SEK/HKD)',
      },
      'revenue_unit': {
        'type': ['string', 'null'],
        'description': 'unit | thousand | million | billion',
      },
      'operating_income_amount': {'type': ['number', 'null']},
      'net_income_amount': {'type': ['number', 'null']},
      'source_url': {'type': 'string', 'description': '검증 가능한 소스 URL'},
      'source_quote': {'type': 'string', 'description': '근거 텍스트 발췌 (300자 이내).'},
      'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
    },
    'required': ['fiscal_year', 'revenue_amount', 'source_quote', 'confidence'],
  },
}

UNIT_TO_MILLION = {
  'unit': 1.0 / 1_000_000.0,
  'thousand': 0.001,
  'million': 1.0,
  'billion': 1000.0,
}


def _ask_claude(llm, name: str, country: str) -> dict | None:
  """Claude web_search tool 로 회사 매출 추출."""
  prompt = (
    f"Find the most recent annual revenue (FY2024 preferred, FY2025 if more recent reported, "
    f"FY2023 fallback) for '{name}' headquartered in {country}. "
    f"Use web_search if needed. Prefer authoritative sources: company annual report, "
    f"investor relations page, Berylls/marklines/Wikipedia, major news. "
    f"Report the GLOBAL CONSOLIDATED revenue (not regional/segment). "
    f"After determining the number, call submit_financials with the result. "
    f"If you genuinely cannot find a credible figure, set revenue_amount=null and confidence=low."
  )
  try:
    resp = llm.messages.create(
      model=DEFAULT_MODEL,
      max_tokens=4096,
      tools=[
        {'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 4},
        EXTRACT_TOOL,
      ],
      messages=[{'role': 'user', 'content': prompt}],
    )
    for block in resp.content:
      if getattr(block, 'type', None) == 'tool_use' and getattr(block, 'name', None) == 'submit_financials':
        return dict(block.input)
    logger.debug(f'{name}: tool_use 응답 없음')
    return None
  except Exception as e:
    logger.error(f'{name} Claude 호출 실패: {e}')
    return None


def main() -> None:
  api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
  if not api_key:
    logger.error('ANTHROPIC_API_KEY 미설정')
    sys.exit(1)

  if not UNRESOLVED_PATH.exists():
    logger.warning('_top100_unresolved.json 없음')
    return

  queue = json.loads(UNRESOLVED_PATH.read_text(encoding='utf-8'))
  if not queue:
    logger.info('큐 비어있음')
    return

  import anthropic
  llm = anthropic.Anthropic(api_key=api_key)

  upserts: list[dict] = []
  log_entries: list[dict] = []
  remaining: list[dict] = []

  for entry in queue:
    name = entry.get('name') or entry.get('name_kr')
    country = entry.get('country', '')
    cid = entry.get('company_id')
    if not cid:
      logger.warning(f'{name}: company_id 없음 — skip')
      continue

    logger.info(f'{name} ({country}) 검색 중...')
    extracted = _ask_claude(llm, name, country)
    if not extracted or extracted.get('revenue_amount') is None:
      logger.warning(f'{name}: 검색 실패 또는 매출 미발견')
      remaining.append({**entry, 'reason': 'websearch_no_result'})
      continue

    if extracted.get('confidence') == 'low':
      logger.warning(f'{name}: confidence=low — skip')
      remaining.append({**entry, 'reason': 'low_confidence', 'extracted': extracted})
      continue

    rev_amount = float(extracted['revenue_amount'])
    rev_currency = (extracted.get('revenue_currency') or 'USD').upper()
    rev_unit = (extracted.get('revenue_unit') or 'million').lower()
    fy = int(extracted.get('fiscal_year') or 2024)
    multiplier = UNIT_TO_MILLION.get(rev_unit, 1.0)
    revenue_million = rev_amount * multiplier

    if revenue_million <= 0 or revenue_million > 1_000_000_000:
      logger.warning(f'{name}: revenue out of range ({revenue_million})')
      remaining.append({**entry, 'reason': 'revenue_out_of_range', 'extracted': extracted})
      continue

    op_million = None
    if extracted.get('operating_income_amount') is not None:
      op_million = float(extracted['operating_income_amount']) * multiplier
    ni_million = None
    if extracted.get('net_income_amount') is not None:
      ni_million = float(extracted['net_income_amount']) * multiplier

    upserts.append({
      'company_id': cid,
      'period_type': 'annual',
      'fiscal_year': fy,
      'fiscal_quarter': None,
      'period_end_date': f'{fy}-12-31',
      'currency': rev_currency,
      'revenue': round(revenue_million, 4),
      'operating_income': round(op_million, 4) if op_million is not None else None,
      'net_income': round(ni_million, 4) if ni_million is not None else None,
    })
    log_entries.append({
      'name_kr': entry.get('name_kr'), 'company_id': cid,
      'extracted': extracted,
    })
    logger.info(
      f'{name}: FY{fy} revenue={revenue_million:.0f}M {rev_currency} '
      f'(confidence={extracted.get("confidence")})'
    )

  if upserts:
    upsert_rows('financials', upserts, 'company_id,period_type,fiscal_year,fiscal_quarter')
    logger.info(f'web_search 수집 {len(upserts)}행 upsert')

  LOG_PATH.write_text(json.dumps(log_entries, ensure_ascii=False, indent=2), encoding='utf-8')
  UNRESOLVED_PATH.write_text(json.dumps(remaining, ensure_ascii=False, indent=2), encoding='utf-8')
  logger.info(f'완료: upsert {len(upserts)} / 미해결 {len(remaining)}')


if __name__ == '__main__':
  main()
