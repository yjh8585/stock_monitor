"""
Top100 폴백 — marklines 미커버 회사를 회사 IR/홈페이지·웹 검색으로 보강.
다단계 흐름:
  1. _top100_unresolved.json 큐 읽기
  2. 회사별:
     a. companies.homepage_url 또는 IR 경로 후보 → requests로 fetch (HTML/PDF)
     b. Anthropic Claude (tool_use) 로 매출/영업이익 추출
     c. 검증 후 financials upsert
     d. 실패 시 DuckDuckGo HTML 검색 → 상위 결과 fetch + LLM 추출
     e. 모두 실패 → unresolved 재기록 (수동 보강용)

환경변수: ANTHROPIC_API_KEY (.env.local), MODEL (default claude-haiku-4-5-20251001).
"""
import json
import os
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows  # noqa: E402
from lib.financial_sources import SOURCE_WEB_SEARCH  # noqa: E402

UNRESOLVED_PATH = Path(__file__).parent / '_top100_unresolved.json'
FALLBACK_LOG_PATH = Path(__file__).parent / '_top100_fallback_log.json'

DEFAULT_MODEL = os.environ.get('MODEL', 'claude-haiku-4-5-20251001')
USER_AGENT = (
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
)
HTTP_TIMEOUT = 20
MAX_TEXT_CHARS = 30_000

IR_PATH_HINTS = [
  '/investors', '/investor-relations', '/about/investor', '/about/investors',
  '/financial', '/financials', '/about/finance', '/financial-information',
  '/en/investors', '/en/about/investor',
]

# Tool schema for structured extraction
EXTRACT_TOOL = {
  'name': 'submit_financials',
  'description': 'Submit extracted annual financial data for the company.',
  'input_schema': {
    'type': 'object',
    'properties': {
      'fiscal_year': {'type': 'integer', 'description': 'Fiscal year (e.g. 2024).'},
      'revenue_amount': {'type': ['number', 'null']},
      'revenue_currency': {'type': ['string', 'null'], 'description': 'ISO 4217 (USD/EUR/JPY/CNY/KRW etc.)'},
      'revenue_unit': {
        'type': ['string', 'null'],
        'description': 'unit | thousand | million | billion',
      },
      'operating_income_amount': {'type': ['number', 'null']},
      'net_income_amount': {'type': ['number', 'null']},
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


def _fetch_text(url: str) -> str:
  """HTML/PDF에서 본문 텍스트 반환 (max MAX_TEXT_CHARS)."""
  try:
    r = requests.get(url, headers={'User-Agent': USER_AGENT}, timeout=HTTP_TIMEOUT)
    if r.status_code != 200:
      return ''
    ct = r.headers.get('content-type', '').lower()
    if 'pdf' in ct or url.lower().endswith('.pdf'):
      try:
        from pypdf import PdfReader
        from io import BytesIO
        reader = PdfReader(BytesIO(r.content))
        text = '\n'.join((p.extract_text() or '') for p in reader.pages[:30])
        return text[:MAX_TEXT_CHARS]
      except Exception as e:
        logger.debug(f'PDF 파싱 실패 {url}: {e}')
        return ''
    soup = BeautifulSoup(r.content, 'html.parser')
    for tag in soup(['script', 'style', 'noscript', 'svg']):
      tag.decompose()
    text = soup.get_text('\n', strip=True)
    return text[:MAX_TEXT_CHARS]
  except Exception as e:
    logger.debug(f'fetch 실패 {url}: {e}')
    return ''


def _candidate_urls(homepage: str | None) -> list[str]:
  """홈페이지 URL → IR 페이지 후보."""
  if not homepage:
    return []
  base = homepage.rstrip('/')
  return [base] + [base + p for p in IR_PATH_HINTS]


def _extract_with_llm(client_anthropic, name: str, country: str, text: str) -> dict | None:
  """Claude tool_use 로 매출/영업이익 추출."""
  if not text or len(text) < 100:
    return None
  prompt = (
    f'다음은 {name} ({country}) 회사 페이지에서 추출한 텍스트입니다. '
    f'가장 최근 (FY2024 우선, 없으면 FY2023) 연간 매출(revenue), 영업이익, 순이익을 추출해 '
    f'submit_financials 도구로 응답하세요. 정보가 명확하지 않으면 confidence=low 또는 null 반환.\n\n'
    f'--- TEXT ---\n{text}'
  )
  try:
    resp = client_anthropic.messages.create(
      model=DEFAULT_MODEL,
      max_tokens=2048,
      tools=[EXTRACT_TOOL],
      tool_choice={'type': 'tool', 'name': 'submit_financials'},
      messages=[{'role': 'user', 'content': prompt}],
    )
    for block in resp.content:
      if block.type == 'tool_use' and block.name == 'submit_financials':
        return dict(block.input)
    return None
  except Exception as e:
    logger.error(f'LLM 호출 실패: {e}')
    return None


def _to_millions_krw(value: float, currency: str, unit: str, fx_map: dict[str, float]) -> float | None:
  """LLM 응답값 → 백만원."""
  if value is None:
    return None
  multiplier = UNIT_TO_MILLION.get((unit or 'million').lower(), 1.0)
  amount_in_currency_million = value * multiplier
  if currency == 'KRW':
    return amount_in_currency_million
  rate = fx_map.get(currency)
  if rate is None:
    return None
  return amount_in_currency_million * rate


def _ddg_search(query: str, max_results: int = 3) -> list[str]:
  """DuckDuckGo HTML 검색 → URL list."""
  try:
    r = requests.post(
      'https://duckduckgo.com/html/',
      data={'q': query},
      headers={'User-Agent': USER_AGENT},
      timeout=HTTP_TIMEOUT,
    )
    soup = BeautifulSoup(r.content, 'html.parser')
    hrefs: list[str] = []
    for a in soup.select('a.result__a'):
      href = a.get('href')
      if href and href.startswith('http'):
        hrefs.append(href)
        if len(hrefs) >= max_results:
          break
    return hrefs
  except Exception as e:
    logger.debug(f'DDG 검색 실패: {e}')
    return []


def _load_fx_map(client) -> dict[str, float]:
  """exchange_rates_live → {currency: rate_to_krw}."""
  rows = (
    client.table('exchange_rates_live').select('base,quote,rate').eq('quote', 'KRW').execute().data
  ) or []
  fx = {r['base']: float(r['rate']) for r in rows}
  fx['KRW'] = 1.0
  return fx


def main() -> None:
  api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
  if not api_key:
    logger.error('ANTHROPIC_API_KEY 미설정 — 누락 list만 출력하고 종료')
    sys.exit(1)

  if not UNRESOLVED_PATH.exists():
    logger.warning(f'{UNRESOLVED_PATH.name} 없음 — collect_marklines.py 먼저 실행')
    sys.exit(0)

  queue = json.loads(UNRESOLVED_PATH.read_text(encoding='utf-8'))
  if not queue:
    logger.info('큐 비어있음')
    return

  import anthropic
  llm = anthropic.Anthropic(api_key=api_key)
  client = get_client()
  fx_map = _load_fx_map(client)

  fallback_log: list[dict] = []
  upserts: list[dict] = []
  remaining: list[dict] = []

  # company_id 매핑이 없으면 name_kr → companies.id 조회
  cmap = {
    c['name_kr']: c['id']
    for c in (client.table('companies').select('id,name_kr').execute().data or [])
  }

  for entry in queue:
    name_kr = entry.get('name_kr')
    name = entry.get('name') or name_kr
    company_id = entry.get('company_id') or cmap.get(name_kr)
    if not company_id:
      logger.warning(f'{name_kr}: company_id 없음 — skip')
      continue

    # 1차: 회사 홈페이지/IR
    extracted = None
    text_source = None
    for url in _candidate_urls(entry.get('homepage_url')):
      text = _fetch_text(url)
      if not text or len(text) < 200:
        continue
      ext = _extract_with_llm(llm, name, entry.get('country', ''), text)
      if ext and ext.get('revenue_amount') is not None and ext.get('confidence') in ('high', 'medium'):
        extracted = ext
        text_source = url
        break
      time.sleep(0.5)

    # 2차: DDG 검색 폴백
    if not extracted:
      query = f'{name} 2024 annual revenue investor'
      for url in _ddg_search(query):
        text = _fetch_text(url)
        if not text or len(text) < 200:
          continue
        ext = _extract_with_llm(llm, name, entry.get('country', ''), text)
        if ext and ext.get('revenue_amount') is not None and ext.get('confidence') in ('high', 'medium'):
          extracted = ext
          text_source = url
          break
        time.sleep(0.5)

    if not extracted:
      remaining.append({**entry, 'reason': 'all_fallback_failed'})
      continue

    # 검증
    rev_amount = extracted.get('revenue_amount')
    rev_currency = (extracted.get('revenue_currency') or 'USD').upper()
    rev_unit = extracted.get('revenue_unit') or 'million'
    fy = int(extracted.get('fiscal_year') or 2024)

    revenue_million = (rev_amount or 0) * UNIT_TO_MILLION.get(rev_unit.lower(), 1.0)
    if revenue_million <= 0 or revenue_million > 1_000_000_000:  # > 1조 USD = 비현실
      remaining.append({**entry, 'reason': 'revenue_out_of_range', 'extracted': extracted})
      continue

    op_income_million = None
    if extracted.get('operating_income_amount') is not None:
      op_income_million = extracted['operating_income_amount'] * UNIT_TO_MILLION.get(rev_unit.lower(), 1.0)

    net_income_million = None
    if extracted.get('net_income_amount') is not None:
      net_income_million = extracted['net_income_amount'] * UNIT_TO_MILLION.get(rev_unit.lower(), 1.0)

    upserts.append({
      'company_id': company_id,
      'period_type': 'annual',
      'fiscal_year': fy,
      'fiscal_quarter': None,
      'period_end_date': f'{fy}-12-31',
      'currency': rev_currency,
      'source': SOURCE_WEB_SEARCH,
      'revenue': round(revenue_million, 4),
      'operating_income': round(op_income_million, 4) if op_income_million is not None else None,
      'net_income': round(net_income_million, 4) if net_income_million is not None else None,
    })
    fallback_log.append({
      'name_kr': name_kr,
      'company_id': company_id,
      'source_url': text_source,
      'extracted': extracted,
    })
    logger.info(
      f'{name_kr}: FY{fy} revenue={revenue_million:.0f}M {rev_currency} '
      f'(confidence={extracted.get("confidence")}, source={text_source})'
    )

  # 결과 저장
  if upserts:
    upsert_rows('financials', upserts, 'company_id,period_type,fiscal_year,fiscal_quarter')
    logger.info(f'폴백 수집 {len(upserts)}행 upsert')

  FALLBACK_LOG_PATH.write_text(
    json.dumps(fallback_log, ensure_ascii=False, indent=2), encoding='utf-8'
  )
  UNRESOLVED_PATH.write_text(
    json.dumps(remaining, ensure_ascii=False, indent=2), encoding='utf-8'
  )

  logger.info(
    f'완료: upsert {len(upserts)} / 보강 실패 {len(remaining)} / log {FALLBACK_LOG_PATH.name}'
  )


if __name__ == '__main__':
  main()
