"""
marklines.com top500 페이지 직접 GET (사용자 쿠키 사용)
→ Business Highlights 섹션 추출 → LLM 정형화 → financials upsert.

보안 프로그램이 브라우저 자동화(Playwright/Selenium)를 차단하는 환경 대응.
사용자 본인 Chrome marklines 세션 쿠키만 있으면 동작 (만료 시 재발급).

전제
----
- scripts/.env 의 MARKLINES_COOKIE: Chrome DevTools Network 탭의 marklines.com 요청 Cookie 헤더 통째
- ANTHROPIC_API_KEY 설정

대상 결정
--------
- TARGET_TICKERS 환경변수: 콤마 분리된 ticker 목록 (우선)
- 미설정 시: page='parts-top100' 회사 중 financials 누락 또는 operating_income NULL
"""
import json
import os
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

import requests  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

from lib.db import get_client, upsert_rows  # noqa: E402
from lib.financial_sources import SOURCE_MARKLINES  # noqa: E402

SLUG_MAP_PATH = Path(__file__).parent / 'lib' / 'marklines_slugs.json'
LOG_PATH = Path(__file__).parent / '_marklines_direct_log.json'
DEFAULT_MODEL = os.environ.get('MODEL', 'claude-haiku-4-5-20251001')
URL_TPL = 'https://www.marklines.com/en/top500/{slug}'

EXTRACT_TOOL = {
  'name': 'submit_financials',
  'description': (
    'Submit headquarters/global consolidated annual revenue and EBIT (operating income) '
    'from marklines Business Highlights section.'
  ),
  'input_schema': {
    'type': 'object',
    'properties': {
      'fiscal_year': {'type': 'integer', 'description': 'Most recent fiscal year shown (e.g., 2024)'},
      'revenue_amount': {'type': ['number', 'null']},
      'revenue_currency': {'type': ['string', 'null'], 'description': 'ISO 3-letter (EUR/USD/JPY/CNY)'},
      'revenue_unit': {'type': ['string', 'null'], 'enum': ['unit', 'thousand', 'million', 'billion']},
      'operating_income_amount': {
        'type': ['number', 'null'],
        'description': 'EBIT or Operating Income, same currency/unit as revenue',
      },
      'net_income_amount': {'type': ['number', 'null']},
      'source_quote': {'type': 'string', 'description': 'Exact text segment confirming the values'},
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

# 국가별 예상 통화 — 다른 통화로 잡히면 LLM 오인식 의심
COUNTRY_CURRENCY = {
  'DE': {'EUR'}, 'FR': {'EUR'}, 'IT': {'EUR'}, 'ES': {'EUR'},
  'AT': {'EUR'}, 'NL': {'EUR'}, 'IE': {'EUR'}, 'CH': {'EUR', 'CHF', 'USD'},
  'JP': {'JPY'}, 'CN': {'CNY', 'USD'}, 'HK': {'HKD', 'USD', 'CNY'},
  'US': {'USD'}, 'CA': {'CAD', 'USD'}, 'MX': {'MXN', 'USD'},
  'IN': {'INR'}, 'KR': {'KRW'}, 'GB': {'GBP', 'EUR'}, 'SE': {'SEK', 'EUR', 'USD'},
}


def _safe_float(v) -> float | None:
  if v is None:
    return None
  try:
    return float(v)
  except (TypeError, ValueError):
    return None


def _to_slug(name: str) -> str:
  """fallback slug — name lowercase + 비영숫자→하이픈."""
  s = (name or '').lower().strip()
  s = re.sub(r'[^a-z0-9]+', '-', s)
  return re.sub(r'-+', '-', s).strip('-')


def _load_slug_map() -> dict[str, str]:
  if not SLUG_MAP_PATH.exists():
    return {}
  data = json.loads(SLUG_MAP_PATH.read_text(encoding='utf-8'))
  return {k: v for k, v in data.items() if not k.startswith('_')}


def _build_session() -> requests.Session:
  cookie = os.environ.get('MARKLINES_COOKIE', '').strip()
  if not cookie:
    logger.error('MARKLINES_COOKIE 미설정 — scripts/.env 에 등록 필요')
    sys.exit(1)
  s = requests.Session()
  s.headers.update({
    'User-Agent': (
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    ),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
    'Cookie': cookie,
    'Referer': 'https://www.marklines.com/en/',
  })
  return s


def _verify_session(session: requests.Session) -> bool:
  """Bosch 페이지의 Business Highlights anchor 존재 = 로그인 인정."""
  try:
    r = session.get(URL_TPL.format(slug='bosch'), timeout=30, allow_redirects=True)
    if r.status_code != 200 or 'top500/bosch' not in r.url:
      return False
    return 'id="highlight"' in r.text and 'Business Highlights' in r.text
  except Exception:
    return False


def _fetch_marklines_page(session: requests.Session, slug: str) -> str | None:
  url = URL_TPL.format(slug=slug)
  try:
    r = session.get(url, timeout=30, allow_redirects=True)
    if r.status_code != 200:
      logger.warning(f'  HTTP {r.status_code} {url}')
      return None
    if 'top500' not in r.url:
      logger.warning(f'  리다이렉트 {url} → {r.url}')
      return None
    return r.text
  except Exception as e:
    logger.error(f'  GET 실패 {url}: {e}')
    return None


def _extract_business_highlights(html: str) -> str | None:
  """상단 Sales Turnover 카드 + Business Highlights + 후속 Data 섹션 표 추출.

  회사마다 표 위치가 다르다:
  - Bosch: Business Highlights 섹션 안에 Financial Overview 표 (매출+EBIT)
  - Harman: Business Highlights는 narrative만, 후속 Data 섹션에 'Sales (in KRW billion)' 표

  → next h2 stop 제거하고 Business Highlights 부터 100k chars 슬라이스.
  → 추가로 페이지 내 모든 <table>의 텍스트도 별도 수집해 LLM이 정량 데이터 우선 보도록.
  """
  soup = BeautifulSoup(html, 'html.parser')
  for tag in soup(['script', 'style', 'noscript']):
    tag.decompose()

  parts: list[str] = []

  # 1) 상단 요약 카드
  for title_p in soup.find_all('p', class_='company-contents-title'):
    sib = title_p.find_next_sibling()
    if sib:
      txt = (title_p.get_text(' ', strip=True) + ' ' + sib.get_text(' ', strip=True)).strip()
      if txt:
        parts.append(txt)

  # 2) Business Highlights + 후속 100k chars (Data 섹션 표 포함)
  start_idx = html.find('<h2 id="highlight"')
  if start_idx >= 0:
    section_html = html[start_idx:start_idx + 100_000]
    section_soup = BeautifulSoup(section_html, 'html.parser')
    for tag in section_soup(['script', 'style', 'noscript']):
      tag.decompose()
    section_text = section_soup.get_text(' ', strip=True)
    section_text = re.sub(r'\s{2,}', ' ', section_text)
    if section_text:
      parts.append(section_text)

  # 3) 페이지 내 모든 <table> 텍스트 (숫자 포함된 표만 — 정량 데이터)
  table_chunks: list[str] = []
  for table in soup.find_all('table'):
    t = table.get_text(' ', strip=True)
    t = re.sub(r'\s{2,}', ' ', t)
    # 숫자 패턴 (1,234 또는 1234.5) 포함된 표만
    if t and re.search(r'\d{1,3}(?:,\d{3})+|\d+\.\d+', t):
      # 단위 힌트 추정
      unit_hint = ''
      m = re.search(r'\(in\s+([A-Z]{3}\s+(?:million|billion|thousand))\)', t, re.I)
      if m:
        unit_hint = f' [unit: {m.group(1)}]'
      table_chunks.append(f'TABLE{unit_hint}: ' + t[:3000])
  if table_chunks:
    parts.append('\n--- ALL TABLES ---\n' + '\n\n'.join(table_chunks[:8]))

  text = '\n\n'.join([p for p in parts if p]).strip()
  if not text:
    return None
  return text[:80_000]


COUNTRY_NAME = {
  'DE': 'Germany', 'FR': 'France', 'IT': 'Italy', 'ES': 'Spain', 'AT': 'Austria',
  'NL': 'Netherlands', 'IE': 'Ireland', 'CH': 'Switzerland', 'JP': 'Japan',
  'CN': 'China', 'HK': 'Hong Kong', 'US': 'USA', 'CA': 'Canada', 'MX': 'Mexico',
  'IN': 'India', 'KR': 'South Korea', 'GB': 'United Kingdom', 'SE': 'Sweden',
}


def _extract_via_llm(llm, name: str, country: str, text: str) -> dict | None:
  expected_curr = COUNTRY_CURRENCY.get(country or '', set())
  curr_hint = (
    f"This company is headquartered in {COUNTRY_NAME.get(country, country)}. "
    f"Expected reporting currency: {' or '.join(sorted(expected_curr))}. "
    if expected_curr else ''
  )
  prompt = (
    f"This is the marklines.com top500 Business Highlights section text for '{name}' ({country}).\n"
    f"{curr_hint}"
    f"\n=== EXTRACTION RULES ===\n"
    f"1. PREFER values from a 'TABLE' block (the section starts with 'TABLE [unit: ...]:'). "
    f"Tables are the most reliable source. Narrative text often paraphrases or rounds.\n"
    f"2. Use the 'Overall' / 'Net Sales' / 'Total' / 'Group' row — NOT segment/subsidiary rows.\n"
    f"3. Pick the MOST RECENT fiscal year shown.\n"
    f"4. Report values in the ORIGINAL currency AND unit AS PRINTED in the table header.\n"
    f"   - '(in million EUR)' → revenue_unit='million', currency='EUR'\n"
    f"   - '(in KRW billion)' / '(KRW billion)' → revenue_unit='billion', currency='KRW'\n"
    f"   - '(in JPY million)' → revenue_unit='million', currency='JPY'\n"
    f"   - DO NOT convert. If table says 14,275 and unit is billion KRW, report 14275 with unit='billion'.\n"
    f"5. If multiple tables exist, prefer the one labeled 'Sales' / 'Net Sales' / 'Total Revenue'.\n"
    f"6. EBIT/Operating Income may be in the SAME table as revenue, or a separate table — search both.\n"
    f"7. Numbers in brackets (xxx) indicate negative values (loss).\n"
    f"8. If you cannot find a clear table or unit, set confidence='low' but still report best guess.\n"
    f"\nThen call submit_financials.\n\n--- PAGE TEXT ---\n{text}"
  )
  try:
    resp = llm.messages.create(
      model=DEFAULT_MODEL, max_tokens=2048,
      tools=[EXTRACT_TOOL],
      tool_choice={'type': 'tool', 'name': 'submit_financials'},
      messages=[{'role': 'user', 'content': prompt}],
    )
    for block in resp.content:
      if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_financials':
        return dict(block.input)
    return None
  except Exception as e:
    msg = str(e)
    if '429' in msg or 'rate_limit' in msg:
      logger.warning('  rate limit — 60s 대기 후 재시도')
      time.sleep(60)
      return _extract_via_llm(llm, name, country, text)
    logger.error(f'  Claude 호출 실패: {e}')
    return None


def _resolve_targets(client) -> list[dict]:
  """TARGET_TICKERS 우선, 없으면 parts-top100 중 매출 또는 EBIT 누락 회사."""
  raw = os.environ.get('TARGET_TICKERS', '').strip()
  target_filter = {t.strip() for t in raw.split(',') if t.strip()}

  if target_filter:
    rows = (
      client.table('companies').select('id,ticker,name,name_kr,country,status')
      .in_('ticker', list(target_filter)).execute().data or []
    )
    return [r for r in rows if r.get('status') == 'active']

  pages = client.table('company_pages').select('company_id').eq('page', 'parts-top100').execute().data
  cids = [p['company_id'] for p in (pages or [])]
  rows = (
    client.table('companies').select('id,ticker,name,name_kr,country,status,data_source')
    .in_('id', cids).eq('status', 'active').execute().data or []
  )
  fin = (
    client.table('financials').select('company_id,revenue,operating_income,fiscal_year')
    .eq('period_type', 'annual').limit(50_000).execute().data or []
  )
  # 회사별 최신연도 record 1개
  by_cid: dict[str, dict] = {}
  for f in fin:
    cur = by_cid.get(f['company_id'])
    if cur is None or (f.get('fiscal_year') or 0) > (cur.get('fiscal_year') or 0):
      by_cid[f['company_id']] = f
  out: list[dict] = []
  for r in rows:
    f = by_cid.get(r['id'])
    if f is None or f.get('revenue') is None or f.get('operating_income') is None:
      out.append(r)
  return out


def main() -> None:
  api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
  if not api_key:
    logger.error('ANTHROPIC_API_KEY 미설정')
    sys.exit(1)

  session = _build_session()
  logger.info('marklines 세션 검증...')
  if not _verify_session(session):
    logger.error(
      'marklines 세션 무효 — scripts/.env 의 MARKLINES_COOKIE 갱신 필요. '
      'Chrome DevTools Network 탭에서 marklines.com 요청의 Request Headers > Cookie 통째 복사.'
    )
    sys.exit(2)
  logger.info('  세션 유효')

  client = get_client()
  targets = _resolve_targets(client)
  if not targets:
    logger.warning('대상 회사 없음')
    return
  logger.info(f'대상 회사 {len(targets)}개')

  slug_map = _load_slug_map()

  import anthropic
  llm = anthropic.Anthropic(api_key=api_key)

  upserts: list[dict] = []
  log_entries: list[dict] = []
  failed: list[str] = []

  for c in targets:
    ticker = c['ticker']
    name = c['name']
    slug = slug_map.get(ticker) or _to_slug(name)
    logger.info(f'[{c["name_kr"]}] slug={slug}')

    html = _fetch_marklines_page(session, slug)
    if not html:
      failed.append(f'{c["name_kr"]} ({slug}) - HTTP/redirect')
      continue

    text = _extract_business_highlights(html)
    if not text or len(text) < 100:
      logger.warning('  추출 텍스트 없음/너무 짧음 — 비공개 가능성')
      failed.append(f'{c["name_kr"]} ({slug}) - 텍스트 없음')
      continue
    # 텍스트가 너무 짧으면서 매출 키워드도 없으면 잠금
    if 'Sales Turnover' not in html and 'Business Highlights' not in html:
      logger.warning('  Sales Turnover/Business Highlights 모두 없음 — 잠금')
      failed.append(f'{c["name_kr"]} ({slug}) - 잠금')
      continue

    ext = _extract_via_llm(llm, name, c.get('country', ''), text)
    if not ext or ext.get('revenue_amount') is None:
      logger.warning('  LLM 매출 추출 실패')
      failed.append(f'{c["name_kr"]} ({slug}) - LLM 실패')
      continue
    if ext.get('confidence') == 'low':
      logger.warning(f'  LLM 신뢰도 low — 스킵')
      failed.append(f'{c["name_kr"]} ({slug}) - 신뢰도 낮음')
      continue

    multiplier = UNIT_TO_MILLION.get((ext.get('revenue_unit') or 'million').lower(), 1.0)
    rev_raw = _safe_float(ext.get('revenue_amount'))
    if rev_raw is None:
      logger.warning('  매출 숫자 변환 실패')
      failed.append(f'{c["name_kr"]} ({slug}) - 매출 NaN')
      continue
    rev = rev_raw * multiplier
    if rev <= 0 or rev > 1_000_000_000:
      logger.warning(f'  비정상 revenue {rev}')
      failed.append(f'{c["name_kr"]} ({slug}) - 이상치')
      continue

    # 통화 검증 — country별 예상과 다르나 본문에 해당 통화가 명시되어 있으면 통과
    currency = (ext.get('revenue_currency') or 'EUR').upper()
    expected = COUNTRY_CURRENCY.get(c.get('country') or '')
    if expected and currency not in expected:
      currency_in_body = bool(re.search(rf'\b{re.escape(currency)}\b', text))
      if currency_in_body:
        logger.info(
          f'  통화 {currency}는 country={c.get("country")} 예상과 다르지만 '
          f'본문에 명시되어 있어 통과 (모회사/자회사 통합 보고 가능성)'
        )
      else:
        logger.warning(
          f'  통화 오인식: {currency} (예상 {expected}, country={c.get("country")}) — 스킵'
        )
        failed.append(f'{c["name_kr"]} ({slug}) - 통화 오인식 {currency}')
        continue

    fy = int(ext.get('fiscal_year') or 2024)
    op_raw = _safe_float(ext.get('operating_income_amount'))
    op = round(op_raw * multiplier, 4) if op_raw is not None else None
    ni_raw = _safe_float(ext.get('net_income_amount'))
    ni = round(ni_raw * multiplier, 4) if ni_raw is not None else None

    upserts.append({
      'company_id': c['id'],
      'period_type': 'annual',
      'fiscal_year': fy,
      'fiscal_quarter': None,
      'period_end_date': f'{fy}-12-31',
      'currency': currency,
      'source': SOURCE_MARKLINES,
      'revenue': round(rev, 4),
      'operating_income': op,
      'net_income': ni,
    })
    log_entries.append({
      'name_kr': c['name_kr'],
      'company_id': c['id'],
      'slug': slug,
      'extracted': ext,
    })
    logger.info(
      f'  OK FY{fy} rev={rev:,.0f}M op={op} '
      f'({ext.get("revenue_currency")}, conf={ext.get("confidence")})'
    )
    time.sleep(2)  # marklines rate limit 회피

  if upserts:
    upsert_rows('financials', upserts, 'company_id,period_type,fiscal_year,fiscal_quarter')
    logger.info(f'marklines 직접 수집 {len(upserts)}행 upsert')

  LOG_PATH.write_text(json.dumps(log_entries, ensure_ascii=False, indent=2), encoding='utf-8')
  if failed:
    logger.warning(f'실패 {len(failed)}개: ' + ' / '.join(failed))
  logger.info('완료')


if __name__ == '__main__':
  main()
