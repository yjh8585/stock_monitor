"""
신규 회사 추가 후 재무·메타 데이터를 자동으로 수집·보강한다.

사용법:
  # 모든 누락 회사 자동 (page 매핑된 active 회사 중 financials 또는 business_summary 비어있는 것)
  python scripts/enrich_company.py

  # 특정 ticker 만
  TARGET_TICKERS='AAA,BBB' python scripts/enrich_company.py

  # 특정 페이지 매핑만
  python scripts/enrich_company.py --page parts-top100

수집 흐름 (회사별):
  1) 누락 분류 (재무/메타)
  2) 재무 수집 — data_source 기반 라우팅:
     - yfinance: yf.Ticker (글로벌 상장사)
     - fnguide:  Playwright (KR 상장사)
     - dart:     collect_dart_audit (KR 비상장사)
     - marklines/기타: Claude web_search 폴백
  3) 메타 보강 — Claude web_search (business_summary/products/customers)
  4) 주가는 별도 스크립트 (collect_prices_live.py / collect_kr_snapshot.py / collect_global_snapshot.py)

환경변수:
  TARGET_TICKERS  콤마 구분 ticker (옵션)
  ANTHROPIC_API_KEY  Claude API 키 (메타·웹검색 폴백용)
  DART_API_KEY    DART API 키 (KR 비상장사)
  MODEL           Anthropic 모델 (default claude-haiku-4-5-20251001)
"""
import argparse
import os
import sys
import time
from pathlib import Path

import yfinance as yf
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from collect_financials import _process_yf_frames, _scrape_company_financials  # noqa: E402
from lib.db import get_client, upsert_rows  # noqa: E402

DEFAULT_MODEL = os.environ.get('MODEL', 'claude-haiku-4-5-20251001')

# ── Claude tool schemas ─────────────────────────────────────────────────
FINANCIAL_TOOL = {
  'name': 'submit_financials',
  'description': 'Submit the latest annual revenue (global consolidated) for the company.',
  'input_schema': {
    'type': 'object',
    'properties': {
      'fiscal_year': {'type': 'integer'},
      'revenue_amount': {'type': ['number', 'null']},
      'revenue_currency': {'type': ['string', 'null']},
      'revenue_unit': {'type': ['string', 'null'], 'description': 'unit|thousand|million|billion'},
      'operating_income_amount': {'type': ['number', 'null']},
      'net_income_amount': {'type': ['number', 'null']},
      'source_url': {'type': 'string'},
      'source_quote': {'type': 'string'},
      'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
    },
    'required': ['fiscal_year', 'revenue_amount', 'source_quote', 'confidence'],
  },
  # prompt caching — 같은 도구 정의가 회사마다 재사용되므로 5분 캐시로 input 비용 ~90% 절감
  'cache_control': {'type': 'ephemeral'},
}

META_TOOL = {
  'name': 'submit_company_meta',
  'description': 'Submit company description, products, customers, homepage URL (Korean preferred).',
  'input_schema': {
    'type': 'object',
    'properties': {
      'business_summary': {'type': 'string', 'description': '한국어 100~250자 1-2문장'},
      'products': {
        'type': 'array',
        'items': {'type': 'object', 'properties': {'name': {'type': 'string'}}, 'required': ['name']},
      },
      'customers': {
        'type': 'array',
        'items': {'type': 'object', 'properties': {'name': {'type': 'string'}}, 'required': ['name']},
      },
      'homepage_url': {
        'type': ['string', 'null'],
        'description': '회사 공식 홈페이지 URL (https:// 포함). 추정 금지 — 검색 결과에서 확인된 URL만. 없으면 null.',
      },
      'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
    },
    'required': ['business_summary', 'products', 'customers', 'confidence'],
  },
  # prompt caching — 같은 도구 정의가 회사마다 재사용되므로 5분 캐시로 input 비용 ~90% 절감
  'cache_control': {'type': 'ephemeral'},
}

UNIT_TO_MILLION = {
  'unit': 1.0 / 1_000_000.0,
  'thousand': 0.001,
  'million': 1.0,
  'billion': 1000.0,
}

import re

# DB 마이그레이션(20260509000002_normalize_customers_v2.sql) 의 normalize_customer_name 함수와 동기화 유지.
# - 한글-영문 괄호 패턴 자동 정리
# - 법인격 접미사 제거
# - 명시적 표준명 매핑
CUSTOMER_NORMALIZE: dict[str, str] = {}
for std, variants in [
  ('폭스바겐', ['Volkswagen', 'Volkswagen Group', 'FAW Volkswagen']),
  ('GM', ['General Motors', '제너럴모터스', '지엠']),
  ('한국지엠', ['한국GM', '한국 GM']),
  ('포드', ['Ford', 'Ford Motor', 'Ford Motor Company']),
  ('BMW', ['BMW Group', 'BMW 그룹', 'BMW Brilliance']),
  ('메르세데스-벤츠', ['Mercedes-Benz', 'Daimler', '다임러', 'DaimlerChrysler', '메르세데스벤츠', '벤츠', 'Mercedes']),
  ('다임러트럭', ['Daimler Trucks', 'Daimler Trucks North America', 'Daimler Truck', 'Freightliner', 'Western Star']),
  ('도요타', ['Toyota', '토요타', 'Toyota Motor', 'Toyota Group', '도요타 그룹']),
  ('혼다', ['Honda', 'Honda Motor', 'Honda Motor Co', 'Honda Motor Co., Ltd', 'Honda Motor Co., Ltd.', 'Honda Motor Company']),
  ('닛산', ['Nissan', 'Nissan Motor', 'Nissan Motor Co', 'Nissan Motor Co., Ltd', 'Nissan Motor Co., Ltd.']),
  ('마쓰다', ['Mazda', 'Mazda Motor', 'Mazda Motor Corporation']),
  ('미쓰비시', ['Mitsubishi', 'Mitsubishi Motors', '미쓰비시자동차']),
  ('스바루', ['Subaru', 'Subaru Corporation']),
  ('스즈키', ['Suzuki', 'Suzuki Motor', 'Suzuki Motor Corporation']),
  ('테슬라', ['Tesla', 'Tesla Shanghai', 'Tesla Inc']),
  ('스텔란티스', ['Stellantis', 'Dodge Ram', 'Dodge', 'Ram', 'Chrysler', 'Jeep', 'Fiat', 'FCA',
              'Stellantis N.V.', 'PSA', 'PSA 그룹', 'PSA Group']),
  ('볼보', ['Volvo', 'Volvo Cars']),
  ('볼보트럭', ['Volvo Group', 'Volvo Trucks']),
  ('아우디', ['Audi']),
  ('포르쉐', ['Porsche']),
  ('람보르기니', ['Lamborghini']),
  ('벤틀리', ['Bentley']),
  ('푸조', ['Peugeot']),
  ('시트로엥', ['Citroen', 'Citroën']),
  ('르노', ['Renault']),
  ('르노코리아', ['Renault Korea', '르노삼성']),
  ('르노-닛산', ['Renault-Nissan', 'Renault-Nissan-Mitsubishi Alliance', 'Renault Nissan Mitsubishi']),
  ('BYD', ['비야디']),
  ('지리', ['Geely']),
  ('체리', ['Chery']),
  ('창안', ['Changan', 'Changan Auto', '창안자동차']),
  ('그레이트월모터스', ['Great Wall Motor', 'Great Wall Motors', 'GWM', '그레이트월모터']),
  ('SAIC', ['SAIC Motor', '상하이자동차']),
  ('베이징현대', ['Beijing Hyundai', '베이징 현대']),
  ('리샹', ['Li Auto', 'Li Xiang']),
  ('NIO', ['Nio', '니오']),
  ('XPeng', ['Xpeng', '샤오펑']),
  ('JAC', ['JAC Group']),
  ('재규어 랜드로버', ['Jaguar Land Rover', 'JLR', '재규어랜드로버']),
  ('페라리', ['Ferrari']),
  ('리비안', ['Rivian']),
  ('빈패스트', ['VinFast']),
  ('루시드', ['Lucid', 'Lucid Motors']),
  ('현대차', ['Hyundai', '현대자동차', '현대', 'Hyundai Motor']),
  ('기아', ['Kia', '기아차', '기아자동차', 'Kia Motor']),
  ('현대차/기아', ['현대기아', 'Hyundai-Kia', '현대-기아', 'Hyundai-Kia Motors', 'Hyundai Kia']),
  ('KG모빌리티', ['KG Mobility', '쌍용', '쌍용자동차']),
  ('PACCAR', ['Paccar', 'PACCAR Inc', 'PACCAR Inc.', 'Kenworth', 'Peterbilt']),
  ('Navistar', ['International']),
  ('MAN', ['만']),
  ('스카니아', ['Scania']),
  ('DAF', ['DAF Trucks']),
  ('에스케이온', ['SK온', 'SK On', 'SK on']),
]:
  CUSTOMER_NORMALIZE[std] = std
  for v in variants:
    CUSTOMER_NORMALIZE[v] = std

_LEGAL_SUFFIX_RE = re.compile(
  r'\s*(AG|GmbH|Inc\.?|Corp\.?|Corporation|Co\.,?\s*Ltd\.?|Co\s+Ltd\.?|Motor\s+Company|'
  r'Motor\s+Corporation|Motors|N\.?V\.?|Group|S\.A\.|SE|plc|PLC)$',
  re.IGNORECASE,
)
_PAREN_RE = re.compile(r'\(([^)]+)\)')
_HANGUL_RE = re.compile(r'[가-힣]')


def _clean_raw_customer(raw: str) -> str:
  """괄호 패턴 + 법인격 정리 — DB 함수와 동일 로직 (Python 사이드)."""
  cleaned = raw.strip()
  m = _PAREN_RE.search(cleaned)
  if m:
    inner = m.group(1).strip()
    outer = _PAREN_RE.sub(' ', cleaned).strip()
    if _HANGUL_RE.search(inner) and not _HANGUL_RE.search(outer):
      cleaned = inner
    elif _HANGUL_RE.search(outer):
      cleaned = outer
    else:
      cleaned = outer
  cleaned = _LEGAL_SUFFIX_RE.sub('', cleaned).strip()
  return cleaned


def _normalize_customers(items: list[dict] | None) -> list[dict]:
  """LLM이 반환한 customers 배열을 표준 OEM명으로 정규화 + 중복 제거."""
  if not items:
    return []
  seen: set[str] = set()
  result: list[dict] = []
  for it in items:
    raw = (it.get('name') or '').strip()
    if not raw:
      continue
    cleaned = _clean_raw_customer(raw)
    std = CUSTOMER_NORMALIZE.get(cleaned, cleaned)
    if std in seen:
      continue
    seen.add(std)
    result.append({'name': std})
  return result


# ── 회사 분류·조회 ───────────────────────────────────────────────────────
def _load_targets(client, page: str | None, target_tickers: set[str]) -> list[dict]:
  """대상 회사 목록 로드. target_tickers 우선, 없으면 page 매핑된 active 회사."""
  q = client.table('companies').select(
    'id,ticker,name,name_kr,country,currency,data_source,status,'
    'products,customers,business_summary,homepage_url'
  )
  if target_tickers:
    q = q.in_('ticker', list(target_tickers))
    return [c for c in (q.execute().data or []) if c.get('status') == 'active']

  # page 매핑 기준
  cp_q = client.table('company_pages').select('company_id')
  if page:
    cp_q = cp_q.eq('page', page)
  pages_data = cp_q.execute().data or []
  if not pages_data:
    return []
  cids = list({p['company_id'] for p in pages_data})
  return [c for c in (q.in_('id', cids).execute().data or []) if c.get('status') == 'active']


def _has_financials(client, cid: str) -> bool:
  rows = (
    client.table('financials').select('company_id').eq('company_id', cid)
    .eq('period_type', 'annual').limit(1).execute().data or []
  )
  return len(rows) > 0


def _missing_meta(c: dict) -> bool:
  return (
    (not c.get('business_summary'))
    or (not c.get('products'))
    or (not c.get('customers'))
    or (not c.get('homepage_url'))
  )


# ── 재무 수집 라우팅 ─────────────────────────────────────────────────────
def _collect_yfinance(c: dict) -> list[dict]:
  ticker = c['ticker']
  cid = c['id']
  default_currency = c.get('currency') or 'USD'
  try:
    t = yf.Ticker(ticker)
    try:
      fin_currency = t.info.get('financialCurrency') or default_currency
    except Exception:
      fin_currency = default_currency
    return _process_yf_frames(
      t.quarterly_income_stmt, t.quarterly_balance_sheet, cid, fin_currency, 'quarterly',
    ) + _process_yf_frames(
      t.income_stmt, t.balance_sheet, cid, fin_currency, 'annual',
    )
  except Exception as e:
    logger.error(f'  yfinance 실패: {e}')
    return []


def _collect_fnguide(c: dict, page) -> list[dict]:
  ticker = c['ticker']
  cid = c['id']
  try:
    return _scrape_company_financials(page, ticker, cid, c.get('currency') or 'KRW')
  except Exception as e:
    logger.error(f'  fnguide 실패: {e}')
    return []


def _collect_dart_audit_single(c: dict) -> list[dict]:
  """DART 감사보고서 단건 (collect_dart_audit 모듈 함수 재사용)."""
  try:
    from collect_dart_audit import _collect_company, _get_dart, _target_years
    odr = _get_dart()
    if not odr:
      return []
    corp_code = odr.find_corp_code(c['name_kr'])
    if not corp_code:
      return []
    return _collect_company(odr, c['id'], str(corp_code), years=_target_years())
  except Exception as e:
    logger.error(f'  DART 실패: {e}')
    return []


def _collect_websearch_financial(llm, c: dict) -> list[dict]:
  """Claude web_search 폴백 — 단일 행 (FY2024) 반환."""
  prompt = (
    f"Find the most recent annual revenue (FY2024 preferred) for '{c['name']}' "
    f"({c.get('country','')}). Use web_search. Report GLOBAL CONSOLIDATED revenue. "
    f"Then call submit_financials."
  )
  try:
    resp = llm.messages.create(
      model=DEFAULT_MODEL, max_tokens=4096,
      tools=[
        {'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 4},
        FINANCIAL_TOOL,
      ],
      messages=[{'role': 'user', 'content': prompt}],
    )
    extracted = None
    for block in resp.content:
      if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_financials':
        extracted = dict(block.input)
        break
    if not extracted or extracted.get('revenue_amount') is None or extracted.get('confidence') == 'low':
      return []
    multiplier = UNIT_TO_MILLION.get((extracted.get('revenue_unit') or 'million').lower(), 1.0)
    rev = float(extracted['revenue_amount']) * multiplier
    if rev <= 0 or rev > 1_000_000_000:
      return []
    fy = int(extracted.get('fiscal_year') or 2024)
    return [{
      'company_id': c['id'],
      'period_type': 'annual',
      'fiscal_year': fy,
      'fiscal_quarter': None,
      'period_end_date': f'{fy}-12-31',
      'currency': (extracted.get('revenue_currency') or 'USD').upper(),
      'revenue': round(rev, 4),
      'operating_income': (
        round(float(extracted['operating_income_amount']) * multiplier, 4)
        if extracted.get('operating_income_amount') is not None else None
      ),
      'net_income': (
        round(float(extracted['net_income_amount']) * multiplier, 4)
        if extracted.get('net_income_amount') is not None else None
      ),
    }]
  except Exception as e:
    logger.error(f'  web_search 재무 실패: {e}')
    return []


# ── 메타 보강 ─────────────────────────────────────────────────────────────
def _enrich_meta(llm, c: dict) -> dict | None:
  prompt = (
    f"For automotive supplier '{c['name']}' (Korean: {c['name_kr']}, country: {c.get('country','')}):\n"
    f"1) business_summary: 100-250자 한국어 1-2문장 (사업 영역/주력 시장/특징)\n"
    f"2) products: 4-6개 주력 제품 (한국어 명사구 우선)\n"
    f"3) customers: 3-5개 주요 OEM 고객사\n"
    f"4) homepage_url: 회사 공식 홈페이지 URL (https:// 포함, 추정 금지 — 웹검색에서 확인된 URL만; 모르면 null)\n"
    f"Use web_search if needed. Then call submit_company_meta."
  )
  try:
    resp = llm.messages.create(
      model=DEFAULT_MODEL, max_tokens=4096,
      tools=[
        {'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 3},
        META_TOOL,
      ],
      messages=[{'role': 'user', 'content': prompt}],
    )
    for block in resp.content:
      if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_company_meta':
        return dict(block.input)
    return None
  except Exception as e:
    msg = str(e)
    if '429' in msg or 'rate_limit' in msg:
      logger.warning(f'  rate limit — 60s 대기')
      time.sleep(60)
      return _enrich_meta(llm, c)
    logger.error(f'  메타 실패: {e}')
    return None


# ── 메인 ─────────────────────────────────────────────────────────────────
def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument('--page', help='page 매핑 필터 (예: parts-top100, domestic)')
  parser.add_argument('--skip-financials', action='store_true', help='재무 수집 skip')
  parser.add_argument('--skip-meta', action='store_true', help='메타 보강 skip')
  parser.add_argument('--skip-news', action='store_true', help='뉴스 수집 skip')
  args = parser.parse_args()

  client = get_client()
  raw = os.environ.get('TARGET_TICKERS', '').strip()
  target_tickers = {t.strip() for t in raw.split(',') if t.strip()}

  targets = _load_targets(client, args.page, target_tickers)
  if not targets:
    logger.warning('대상 회사 없음')
    return
  logger.info(f'대상 회사 {len(targets)}개')

  # 누락 분류
  missing_fin: list[dict] = []
  missing_meta: list[dict] = []
  for c in targets:
    if not args.skip_financials and not _has_financials(client, c['id']):
      missing_fin.append(c)
    if not args.skip_meta and _missing_meta(c):
      missing_meta.append(c)

  logger.info(f'재무 누락 {len(missing_fin)}, 메타 누락 {len(missing_meta)}')

  # ── 재무 수집 ────────────────────────────────────────────────────────────
  fin_rows: list[dict] = []
  if missing_fin:
    by_source: dict[str, list[dict]] = {}
    for c in missing_fin:
      by_source.setdefault(c.get('data_source') or 'other', []).append(c)
    logger.info(f'  data_source 분포: ' + ', '.join(f'{k}={len(v)}' for k, v in by_source.items()))

    # yfinance
    for c in by_source.get('yfinance', []):
      logger.info(f'[yfinance] {c["name_kr"]} ({c["ticker"]})')
      fin_rows.extend(_collect_yfinance(c))

    # fnguide (Playwright 1번만 띄우고 처리)
    fnguide_targets = by_source.get('fnguide', [])
    if fnguide_targets:
      try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
          browser = pw.chromium.launch(headless=True)
          ctx = browser.new_context(user_agent='Mozilla/5.0')
          page = ctx.new_page()
          try:
            for c in fnguide_targets:
              logger.info(f'[fnguide] {c["name_kr"]} ({c["ticker"]})')
              fin_rows.extend(_collect_fnguide(c, page))
          finally:
            browser.close()
      except ImportError:
        logger.error('playwright 미설치 — fnguide skip')

    # DART 감사보고서 (KR 비상장사)
    for c in by_source.get('dart', []):
      logger.info(f'[dart] {c["name_kr"]}')
      fin_rows.extend(_collect_dart_audit_single(c))

    # marklines/other → Claude web_search 폴백
    fallback_targets = by_source.get('marklines', []) + by_source.get('other', [])
    if fallback_targets:
      api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
      if not api_key:
        logger.warning(f'  ANTHROPIC_API_KEY 없음 — marklines/other {len(fallback_targets)}개 skip')
      else:
        import anthropic
        llm = anthropic.Anthropic(api_key=api_key)
        for c in fallback_targets:
          logger.info(f'[websearch] {c["name_kr"]} ({c.get("country","")})')
          fin_rows.extend(_collect_websearch_financial(llm, c))
          time.sleep(3)

  if fin_rows:
    upsert_rows('financials', fin_rows, 'company_id,period_type,fiscal_year,fiscal_quarter')
    logger.info(f'재무 {len(fin_rows)}행 upsert')

  # ── 메타 보강 ────────────────────────────────────────────────────────────
  if missing_meta:
    api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not api_key:
      logger.warning('ANTHROPIC_API_KEY 없음 — 메타 보강 skip')
    else:
      import anthropic
      llm = anthropic.Anthropic(api_key=api_key)
      meta_updated = 0
      for i, c in enumerate(missing_meta, 1):
        logger.info(f'[meta {i}/{len(missing_meta)}] {c["name_kr"]}')
        res = _enrich_meta(llm, c)
        if not res or res.get('confidence') == 'low':
          continue
        payload = {}
        if res.get('business_summary'):
          payload['business_summary'] = res['business_summary']
        if res.get('products'):
          payload['products'] = res['products']
        if res.get('customers'):
          payload['customers'] = _normalize_customers(res['customers'])
        hp = res.get('homepage_url')
        if hp and isinstance(hp, str) and hp.startswith(('http://', 'https://')):
          payload['homepage_url'] = hp.strip()
        if not payload:
          continue
        try:
          client.table('companies').update(payload).eq('id', c['id']).execute()
          meta_updated += 1
        except Exception as e:
          logger.error(f'  UPDATE 실패: {e}')
        time.sleep(5)  # rate limit 회피
      logger.info(f'메타 {meta_updated}/{len(missing_meta)}개 보강')

  # ── 뉴스 수집 (상장사 한정 — 비상장사는 collect_news가 자동 skip) ──────
  if not args.skip_news:
    listed_tickers = [
      c['ticker'] for c in targets
      if c.get('market') and c.get('data_source') != 'dart' and c.get('ticker')
    ]
    if listed_tickers:
      logger.info(f'뉴스 수집 시작 — 상장사 {len(listed_tickers)}개')
      try:
        # collect_news.collectNews() 는 TARGET_TICKERS 환경변수를 읽음
        os.environ['TARGET_TICKERS'] = ','.join(listed_tickers)
        from collect_news import collectNews  # noqa: E402
        collectNews()
      except Exception as e:
        logger.error(f'뉴스 수집 실패: {e}')

  logger.info('완료. 주가는 별도 실행: python scripts/collect_prices_live.py')


if __name__ == '__main__':
  main()
