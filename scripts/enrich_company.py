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
import re
import sys
import time
from pathlib import Path

import yfinance as yf
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from collect_financials import _fetch_company_financials, _process_yf_frames  # noqa: E402
from lib.db import WriteSession, upsert_rows  # noqa: E402
from lib.financial_sources import SOURCE_WEB_SEARCH  # noqa: E402
from lib.text import is_rejection_response, strip_citation_tags  # noqa: E402

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
      # 비상장사 기업가치. 상장사는 market_cap 이 따로 있으므로 채우지 않는다.
      # 🔴 추정 금지 — 보도된 라운드 밸류에이션만. 근거를 못 찾으면 세 필드 모두 null.
      'valuation_usd': {
        'type': ['number', 'null'],
        'description': '비상장사 최신 라운드 기업가치(USD, post-money). 보도로 확인된 값만. 상장사·미확인은 null.',
      },
      'funding_total_usd': {
        'type': ['number', 'null'],
        'description': '누적 투자 유치 금액(USD). 확인된 값만, 미확인은 null.',
      },
      'valuation_asof': {
        'type': ['string', 'null'],
        'description': 'valuation_usd 의 기준일 YYYY-MM-DD (해당 라운드 발표일). 값이 있으면 필수.',
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

# customers 정규화는 DB 트리거(`companies_normalize_customers`, 마이그레이션
# 20260522000001)가 BEFORE INSERT/UPDATE 시 자동 처리한다. raw LLM 결과를 그대로
# UPDATE 페이로드에 넣으면 트리거가 `expand_customer_name`으로 OEM 화이트리스트 + 정책
# 매핑 + dedup을 수행. Python에서 별도 normalize 안 함 — SSOT는 DB.


# ── 회사 분류·조회 ───────────────────────────────────────────────────────
def _load_targets(client, page: str | None, target_tickers: set[str]) -> list[dict]:
  """대상 회사 목록 로드. target_tickers 우선, 없으면 page 매핑된 active 회사."""
  q = client.table('companies').select(
    'id,ticker,name,name_kr,country,currency,data_source,status,'
    'products,customers,business_summary,homepage_url,dart_corp_code,'
    'fiscal_year_end_month,market,robot_roles,valuation_usd,funding_total_usd,valuation_asof'
  )

  # 🔴 회사가 **어느 페이지들에** 속하는지 항상 함께 싣는다(`_pages`).
  #    `--page humanoid` 로 걸러도 그 회사가 관련주에도 속할 수 있고, 그때는
  #    고객사를 비우면 안 된다(`_skips_customers` 가 이 값을 본다).
  all_pages = client.table('company_pages').select('company_id,page').execute().data or []
  page_map: dict[str, list[str]] = {}
  for row in all_pages:
    page_map.setdefault(row['company_id'], []).append(row['page'])

  def _decorate(rows: list[dict]) -> list[dict]:
    for c in rows:
      c['_pages'] = page_map.get(c['id'], [])
    return [c for c in rows if c.get('status') == 'active']

  if target_tickers:
    q = q.in_('ticker', list(target_tickers))
    return _decorate(q.execute().data or [])

  # page 매핑 기준
  cids = [cid for cid, pgs in page_map.items() if (page in pgs if page else True)]
  if not cids:
    return []
  return _decorate(q.in_('id', cids).execute().data or [])


def _has_financials(w, cid: str) -> bool:
  rows = (
    w.table('financials').select('company_id').eq('company_id', cid)
    .eq('period_type', 'annual').limit(1).execute().data or []
  )
  return len(rows) > 0


_HANGUL_RE = re.compile(r'[가-힣]')


def _is_korean_summary(text: str | None) -> bool:
  """business_summary 가 한국어로 쓰였나.

  🔴 "비었나"만 보면 안 된다 — yfinance 의 longBusinessSummary 가 영어 원문 그대로
     들어앉은 회사가 있는데(2026-08-25 실측: 휴머노이드 67사 중 22사), 값이 차 있으니
     보강 대상에서 빠져 영영 영어로 남는다. 회사설명은 한국어가 규칙이다.

  한글이 한 자도 없으면 영어로 본다. 한국어 문장에 영문 고유명사가 섞이는 건 정상이므로
  비율은 따지지 않는다.
  """
  return bool(text) and bool(_HANGUL_RE.search(text or ''))


def _skips_customers(c: dict) -> bool:
  """이 회사는 고객사를 **수집하지 않는** 대상인가.

  🔴 휴머노이드는 「고객사 컬럼 삭제 · 수집 안 함」이 확정된 결정이다
     (계획서 `agents/docs/superpowers/plans/2026-08-24-humanoid-research.md` 결정 12,
     사용자 지시). `humanoid_stocks_view` 도 customers 를 빈 배열로 내보내고 그 자리에
     비상장 기업가치를 그린다.

  🔴 2026-08-25 실측 사고: 이 판정이 없어서 `enrich_company.py --page humanoid` 가
     15개사의 고객사를 수집했다. 화면엔 안 나오니 아무도 못 봤다 — 결정 위반이
     **조용히** 일어난 것이다(되돌림: `humanoid_customers_reverted_20260825`).

  ⚠️ 겸업사는 제외한다. 현대차·현대모비스처럼 관련주·국내자동차에도 속한 회사는
     그쪽 화면이 고객사를 쓰므로 비우면 안 된다. 그래서 「휴머노이드 역할이 있고
     **다른 페이지에는 없는**」 회사만 건너뛴다.
  """
  roles = c.get('robot_roles') or []
  if not roles:
    return False
  pages = set(c.get('_pages') or [])
  return not (pages - {'humanoid'})


def _missing_meta(c: dict) -> bool:
  # 🔴 고객사를 수집하지 않는 회사에는 「고객사 없음」을 보강 사유로 세지 않는다.
  #    안 그러면 그 회사들이 매 회차 대상으로 잡혀 헛돈다.
  needs_customers = (not c.get('customers')) and not _skips_customers(c)
  return (
    (not _is_korean_summary(c.get('business_summary')))
    or (not c.get('products'))
    or needs_customers
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


def _collect_fnguide(c: dict) -> list[dict]:
  """KR 상장사 재무 — fnguide 신버전(wcomp) JSON. 브라우저 불필요(2026-08 전환).

  결산월을 넘기지 않으면 12월로 가정해 비-12월 결산사의 연간/분기 판정이 어긋난다.
  """
  try:
    return _fetch_company_financials(
      c['ticker'], c['id'], c.get('currency') or 'KRW',
      fiscal_year_end_month=int(c.get('fiscal_year_end_month') or 12),
    )
  except Exception as e:
    logger.error(f'  fnguide 실패: {e}')
    return []


def _collect_dart_audit_single(w, c: dict) -> list[dict]:
  """DART 감사보고서 단건. companies.dart_corp_code 우선 사용, 미설정 시 resolve 후 캐싱."""
  try:
    from collect_dart_audit import (
      _collect_company,
      _dedup_rows,
      _get_dart,
      _identity_verdict_for_code,
      _resolve_corp_code,
      _target_years,
    )
    odr = _get_dart()
    if not odr:
      return []
    cached_code = c.get('dart_corp_code')
    profile = {
      'ticker': c.get('ticker'),
      'name_kr': c.get('name_kr'),
      'data_source': c.get('data_source'),
      'market': c.get('market'),
      'homepage_url': c.get('homepage_url'),
    }
    corp_code = _resolve_corp_code(odr, c['name_kr'], cached_code, profile)
    if not corp_code:
      return []
    # 새로 resolve된 경우 companies에 캐싱 — 단, 개체 확증(confirm)일 때만.
    # 무검증 캐싱은 동명이인 오배정 corp_code를 영구화한다(과거 워트/지디).
    if not cached_code:
      verdict = _identity_verdict_for_code(str(corp_code), profile)
      if verdict == 'confirm':
        try:
          w.table('companies').update(
            {'dart_corp_code': str(corp_code)}
          ).eq('id', c['id']).execute()
          logger.info(f"  dart_corp_code 캐싱: {c['name_kr']} → {corp_code} (개체확증)")
        except Exception as e:
          logger.warning(f"  dart_corp_code 캐싱 실패 ({c['name_kr']}): {e}")
      else:
        logger.info(
          f"  dart_corp_code 캐싱 보류: {c['name_kr']} → {corp_code} "
          f"(개체검증 {verdict}, 확증 아님 — 수동 매핑 시 확정)"
        )
    # 🔴 `_dedup_rows` 를 반드시 거친다. `_collect_company` 는 행에 메타필드
    #    `_report_fiscal_year` 를 달아 돌려주는데, 그 제거는 `_dedup_rows` 가 맡는다.
    #    빠뜨리면 upsert 가 PGRST204("Could not find the '_report_fiscal_year' column")
    #    로 죽고, **재무 단계에서 죽으니 뒤따르는 메타 보강이 통째로 안 돈다.**
    #    2026-08-25 실측: 이 누락 탓에 DART 대상 회사의 재무·설명이 한 번도 안 들어갔다.
    return _dedup_rows(_collect_company(odr, c['id'], str(corp_code), years=_target_years()))
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
      'source': SOURCE_WEB_SEARCH,
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


_ASOF_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _valuation_payload(c: dict, res: dict) -> dict:
  """비상장 기업가치 UPDATE 조각. 조건에 안 맞으면 빈 dict(=건드리지 않는다).

  🔴 상장사는 손대지 않는다 — 기업가치의 정본은 market_cap 이다.
  🔴 기준일(valuation_asof)이 없거나 기존 값보다 오래됐으면 무시한다. 오래된 라운드로
     최신 값을 덮어쓰면 조용히 후퇴한다(seed 에 2022년 값이 남아 있던 이유).
  funding_total_usd 는 누적액이라 단조 증가한다 — 줄어드는 값은 오답으로 보고 버린다.
  """
  if c.get('market'):
    return {}

  payload: dict = {}
  asof = res.get('valuation_asof')
  val = res.get('valuation_usd')
  if val and isinstance(val, (int, float)) and val > 0 and isinstance(asof, str) and _ASOF_RE.match(asof):
    prev_asof = c.get('valuation_asof')
    if not prev_asof or asof > prev_asof:
      payload['valuation_usd'] = float(val)
      payload['valuation_asof'] = asof

  fund = res.get('funding_total_usd')
  if fund and isinstance(fund, (int, float)) and fund > 0:
    prev_fund = c.get('funding_total_usd')
    if prev_fund is None or float(fund) > float(prev_fund):
      payload['funding_total_usd'] = float(fund)

  return payload


# ── 메타 보강 ─────────────────────────────────────────────────────────────
def _enrich_meta(llm, c: dict) -> dict | None:
  # 비상장사에만 기업가치를 묻는다. 상장사는 market_cap 이 정본이라 물어봐야 잡음만 는다.
  is_unlisted = not c.get('market')
  valuation_ask = (
    f"5) valuation_usd / funding_total_usd / valuation_asof: 비상장사이므로 최신 라운드 "
    f"기업가치(USD post-money)와 누적 투자유치액, 그 발표일(YYYY-MM-DD)을 조사한다. "
    f"🔴 추정 금지 — 보도로 확인된 값만. 못 찾으면 세 필드 모두 null.\n"
    if is_unlisted
    else "5) valuation_usd / funding_total_usd / valuation_asof: 상장사이므로 모두 null.\n"
  )
  prompt = (
    f"For '{c['name']}' (Korean: {c['name_kr']}, country: {c.get('country','')}):\n"
    f"1) business_summary: 100-250자 **한국어** 1-2문장 (사업 영역/주력 시장/특징). "
    f"🔴 영어로 쓰지 말 것 — 영문 사명·제품명은 그대로 두되 문장은 한국어여야 한다.\n"
    f"2) products: 4-6개 주력 제품 (한국어 명사구 우선)\n"
    f"3) customers: 3-5개 주요 고객사\n"
    f"4) homepage_url: 회사 공식 홈페이지 URL (https:// 포함, 추정 금지 — 웹검색에서 확인된 URL만; 모르면 null)\n"
    f"{valuation_ask}"
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

  raw = os.environ.get('TARGET_TICKERS', '').strip()
  target_tickers = {t.strip() for t in raw.split(',') if t.strip()}

  with WriteSession() as w:
    _main_in_session(w, args, target_tickers)


def _main_in_session(w, args, target_tickers: set[str]) -> None:
  targets = _load_targets(w, args.page, target_tickers)
  if not targets:
    logger.warning('대상 회사 없음')
    return
  logger.info(f'대상 회사 {len(targets)}개')

  # 누락 분류
  missing_fin: list[dict] = []
  missing_meta: list[dict] = []
  for c in targets:
    if not args.skip_financials and not _has_financials(w, c['id']):
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

    # fnguide (신버전 JSON — 브라우저 없이 HTTP 요청만)
    for c in by_source.get('fnguide', []):
      logger.info(f'[fnguide] {c["name_kr"]} ({c["ticker"]})')
      fin_rows.extend(_collect_fnguide(c))

    # DART 감사보고서 (KR 비상장사)
    for c in by_source.get('dart', []):
      logger.info(f'[dart] {c["name_kr"]}')
      fin_rows.extend(_collect_dart_audit_single(w, c))

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
    # 🔴 재무 upsert 실패가 **메타 보강까지 삼키지 않게** 한다. 2026-08-25 에 DART 행의
    #    메타필드 하나 때문에 여기서 예외가 나면서, 설명·제품·고객사·기업가치 보강이
    #    통째로 안 돌았다(로그 끝이 traceback 이라 "완료"로 오인하기도 쉬웠다).
    try:
      upsert_rows('financials', fin_rows, 'company_id,period_type,fiscal_year,fiscal_quarter')
      logger.info(f'재무 {len(fin_rows)}행 upsert')
    except Exception as e:
      logger.error(f'재무 upsert 실패 — 메타 보강은 계속한다: {e}')

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
          bs_clean = strip_citation_tags(res['business_summary'])
          if bs_clean and is_rejection_response(bs_clean):
            logger.warning(f'  {c["name_kr"]}: business_summary가 거부 응답 — skip')
          elif bs_clean and not _is_korean_summary(bs_clean):
            # 한국어로 달라고 했는데 영어가 왔다. 기존 값을 영어로 덮어써 봐야
            # 다음 회차에 또 걸리기만 하므로 버린다.
            logger.warning(f'  {c["name_kr"]}: business_summary가 한국어가 아님 — skip')
          elif bs_clean:
            payload['business_summary'] = bs_clean
        if res.get('products'):
          payload['products'] = res['products']
        if res.get('customers') and not _skips_customers(c):
          # DB 트리거(companies_normalize_customers)가 정규화·dedup 자동 처리.
          payload['customers'] = res['customers']
        hp = res.get('homepage_url')
        if hp and isinstance(hp, str) and hp.startswith(('http://', 'https://')):
          payload['homepage_url'] = hp.strip()
        payload.update(_valuation_payload(c, res))
        if not payload:
          continue
        try:
          w.table('companies').update(payload).eq('id', c['id']).execute()
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

  # WriteSession.__exit__이 자동으로 revalidate_for_tables(['companies', ...])를 호출한다.
  logger.info('완료. 주가는 별도 실행: python scripts/collect_prices_live.py')


if __name__ == '__main__':
  main()
