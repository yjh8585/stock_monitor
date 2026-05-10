"""
marklines.com top500 — 해외 비상장사 본사 기준 재무 데이터 수집.
- Playwright로 로그인 (.env.local: MARKLINES_EMAIL / MARKLINES_PASSWORD)
- top500 list 페이지에서 회사 카드 → 우리 DB(data_source='marklines' & page='parts-top100') 매칭
- 회사 상세 페이지에서 본사(headquarters) 기준 매출/영업이익 추출
- financials 테이블 upsert (period_type='annual', fiscal_year=2024)

DOM 구조는 페이지 변경 가능성 있어 셀렉터를 견고하게 잡고, 실패 시 _top100_unresolved.json 에 큐로 남긴다.
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

from lib.db import get_client, upsert_rows  # noqa: E402

LOGIN_URL = 'https://www.marklines.com/en/login'
TOP500_URL = 'https://www.marklines.com/en/top500/?rf=left_menu'

UNRESOLVED_PATH = Path(__file__).parent / '_top100_unresolved.json'
LOG_PATH = Path(__file__).parent / '_marklines_log.json'

# 페이지 통화 표기 → financials.currency 매핑
CURRENCY_TOKENS = {
  'USD': 'USD', 'EUR': 'EUR', 'JPY': 'JPY', 'CNY': 'CNY', 'KRW': 'KRW',
  'GBP': 'GBP', 'CAD': 'CAD', 'INR': 'INR', 'MXN': 'MXN', 'CHF': 'CHF',
  'SEK': 'SEK', 'HKD': 'HKD',
}

# 단위 인식
UNIT_MULTIPLIER = {
  'million': 1.0,         # 백만 단위 (financials는 백만 기준)
  'mil': 1.0, 'm': 1.0, 'mn': 1.0,
  'billion': 1000.0,      # 십억 → 백만 ×1000
  'bil': 1000.0, 'b': 1000.0, 'bn': 1000.0,
  'thousand': 0.001, 'k': 0.001,
}


def _normalize(s: str) -> str:
  """공백/대소문자/괄호 제거 후 lower."""
  return re.sub(r'[\s\(\)\[\]\.,&+\-]+', '', (s or '')).lower()


def _parse_amount(text: str) -> tuple[float, str, float] | None:
  """
  '$45.2 billion' 또는 'EUR 26,974 million' 등 → (value_million, currency, unit_multiplier).
  매출 정수 + currency + unit 인식.
  """
  if not text:
    return None
  s = text.replace(',', '').strip()
  # 통화 토큰
  currency = None
  for tok, code in CURRENCY_TOKENS.items():
    if tok in s.upper() or tok.lower() in s.lower():
      currency = code
      break
  if not currency:
    if '€' in s:
      currency = 'EUR'
    elif '$' in s:
      currency = 'USD'
    elif '¥' in s:
      currency = 'JPY'
    elif '￦' in s or '원' in s:
      currency = 'KRW'
    elif '£' in s:
      currency = 'GBP'
    else:
      currency = 'USD'  # 기본

  # 숫자 + 단위
  m = re.search(r'(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?', s)
  if not m:
    return None
  num = float(m.group(1))
  unit = (m.group(2) or 'million').lower()
  multiplier = UNIT_MULTIPLIER.get(unit, 1.0)
  return num * multiplier, currency, multiplier


def _fetch_fx(client, base: str) -> float | None:
  """exchange_rates_live 에서 base→KRW 환율 조회."""
  if base == 'KRW':
    return 1.0
  rows = (
    client.table('exchange_rates_live')
    .select('rate')
    .eq('base', base)
    .eq('quote', 'KRW')
    .limit(1)
    .execute()
    .data
  )
  return float(rows[0]['rate']) if rows else None


def _login(page, email: str, password: str) -> bool:
  """marklines 로그인. 성공 시 True."""
  try:
    page.goto(LOGIN_URL, timeout=30_000)
    page.wait_for_load_state('domcontentloaded', timeout=30_000)
    # 일반적인 폼 셀렉터 (실제 페이지 구조에 맞춰 조정 필요)
    page.fill('input[name="email"], input[type="email"], #email', email)
    page.fill('input[name="password"], input[type="password"], #password', password)
    page.click('button[type="submit"], input[type="submit"]')
    page.wait_for_load_state('networkidle', timeout=30_000)
    # 로그인 성공 표시: "Logout" 또는 "My Page" 등 노출
    body = page.content()
    return ('logout' in body.lower()) or ('my page' in body.lower()) or ('mypage' in body.lower())
  except Exception as e:
    logger.error(f'로그인 실패: {e}')
    return False


def _extract_top500_companies(page) -> list[dict]:
  """top500 페이지에서 회사 카드 list 추출.
  반환: [{'name': ..., 'detail_url': ..., 'rank': N, ...}].
  실제 DOM 셀렉터는 페이지 구조에 따라 조정.
  """
  page.goto(TOP500_URL, timeout=60_000)
  page.wait_for_load_state('networkidle', timeout=60_000)
  time.sleep(2)

  # 추정 셀렉터 — 페이지에 따라 조정
  rows = page.evaluate("""
    () => {
      const items = [];
      // table tbody tr 또는 list item
      document.querySelectorAll('table tbody tr, .top500-row, .company-row').forEach(el => {
        const cells = el.querySelectorAll('td, .cell');
        if (cells.length < 2) return;
        const link = el.querySelector('a[href*="/top500/"], a[href*="company"]');
        items.push({
          rank: parseInt((cells[0]?.innerText || '').trim()) || null,
          name: (cells[1]?.innerText || link?.innerText || '').trim(),
          detail_url: link?.href || null,
          row_text: el.innerText.trim().substring(0, 500),
        });
      });
      return items;
    }
  """)
  return rows or []


def _scrape_company_detail(page, url: str) -> dict | None:
  """회사 상세 페이지에서 본사 기준 매출/영업이익 추출."""
  try:
    page.goto(url, timeout=30_000)
    page.wait_for_load_state('networkidle', timeout=30_000)
    time.sleep(1)
    # 본사 탭/섹션 우선 (해외 지사 제외)
    body = page.content()
    return {'html': body[:20000]}  # 본문 일부 dump
  except Exception as e:
    logger.error(f'상세 페이지 실패 {url}: {e}')
    return None


def main() -> None:
  email = os.environ.get('MARKLINES_EMAIL', '').strip()
  password = os.environ.get('MARKLINES_PASSWORD', '').strip()
  if not email or not password:
    logger.error('MARKLINES_EMAIL/MARKLINES_PASSWORD 환경변수 미설정 (.env.local)')
    sys.exit(1)

  client = get_client()

  # 1) 우리 DB의 marklines 대상 회사 (parts-top100 매핑 + data_source='marklines')
  pages = client.table('company_pages').select('company_id').eq('page', 'parts-top100').execute().data
  cids = [p['company_id'] for p in (pages or [])]
  if not cids:
    logger.warning('parts-top100 매핑된 회사 없음')
    return

  companies = (
    client.table('companies')
    .select('id,ticker,name,name_kr,country,homepage_url,data_source,status')
    .in_('id', cids)
    .eq('data_source', 'marklines')
    .eq('status', 'active')
    .execute()
    .data or []
  )

  if not companies:
    logger.warning('marklines 수집 대상 없음')
    return

  logger.info(f'marklines 대상 {len(companies)}개')

  # 2) Playwright 로그인 + top500 list 추출
  try:
    from playwright.sync_api import sync_playwright
  except ImportError:
    logger.error('playwright 미설치')
    sys.exit(1)

  unresolved: list[dict] = []
  collected: list[dict] = []
  log_entries: list[dict] = []

  with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    context = browser.new_context(
      user_agent=(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      )
    )
    page = context.new_page()
    try:
      logger.info('marklines 로그인 시도...')
      if not _login(page, email, password):
        logger.error('로그인 실패 — 모든 대상 unresolved 처리')
        for c in companies:
          unresolved.append({
            'name_kr': c['name_kr'], 'name': c['name'], 'country': c['country'],
            'homepage_url': c.get('homepage_url'),
            'reason': 'marklines_login_failed',
          })
      else:
        logger.info('로그인 성공')
        top500 = _extract_top500_companies(page)
        logger.info(f'top500 페이지에서 {len(top500)}개 항목 추출')

        # 회사명 매칭 + detail page scrape
        norm_index = {_normalize(item['name']): item for item in top500}

        for c in companies:
          # 우선 영문 name으로 매칭, 실패 시 name_kr 일부 매칭
          key = _normalize(c['name'].split()[0])  # 'Robert Bosch GmbH' → 'robert' 등
          match = None
          for nm_key, item in norm_index.items():
            if key and (key in nm_key or nm_key.startswith(key)):
              match = item
              break

          if not match:
            unresolved.append({
              'name_kr': c['name_kr'], 'name': c['name'], 'country': c['country'],
              'homepage_url': c.get('homepage_url'),
              'reason': 'marklines_not_found',
            })
            continue

          if not match.get('detail_url'):
            unresolved.append({
              'name_kr': c['name_kr'], 'name': c['name'], 'country': c['country'],
              'homepage_url': c.get('homepage_url'),
              'reason': 'marklines_no_detail_url',
            })
            continue

          detail = _scrape_company_detail(page, match['detail_url'])
          if not detail:
            unresolved.append({
              'name_kr': c['name_kr'], 'name': c['name'], 'country': c['country'],
              'homepage_url': c.get('homepage_url'),
              'reason': 'marklines_detail_fetch_failed',
            })
            continue

          # TODO: detail에서 본사 기준 매출/영업이익 정확 추출
          # 페이지 구조 변경 가능성이 커서 LLM 폴백(collect_top100_fallback.py) 으로 위임 권장
          log_entries.append({
            'name_kr': c['name_kr'], 'company_id': c['id'],
            'detail_url': match['detail_url'],
            'detail_html_excerpt': (detail.get('html') or '')[:500],
          })
          # 폴백 큐에 추가 (텍스트 추출은 LLM이 처리)
          unresolved.append({
            'name_kr': c['name_kr'], 'name': c['name'], 'country': c['country'],
            'homepage_url': c.get('homepage_url'),
            'company_id': c['id'],
            'marklines_detail_url': match['detail_url'],
            'reason': 'pending_extraction',
          })

    finally:
      browser.close()

  # 3) 결과 저장
  if collected:
    upsert_rows('financials', collected, 'company_id,period_type,fiscal_year,fiscal_quarter')
    logger.info(f'marklines 직접 수집 {len(collected)}행 upsert')

  UNRESOLVED_PATH.write_text(json.dumps(unresolved, ensure_ascii=False, indent=2), encoding='utf-8')
  LOG_PATH.write_text(json.dumps(log_entries, ensure_ascii=False, indent=2), encoding='utf-8')
  logger.info(
    f'unresolved {len(unresolved)}건 저장 → {UNRESOLVED_PATH.name}, '
    f'log {len(log_entries)}건 → {LOG_PATH.name}'
  )


if __name__ == '__main__':
  main()
