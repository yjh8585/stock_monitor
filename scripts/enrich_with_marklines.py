"""parts-top100 회사의 description/customers/products를 marklines + LLM 으로 보강.

전제:
  - scripts/.env: MARKLINES_COOKIE, ANTHROPIC_API_KEY
  - companies.business_summary / customers / products / homepage_url 컬럼

흐름 (회사별):
  1) marklines slug 결정 (slug_map → ticker fallback → name fallback)
  2) marklines 페이지 GET → 본문 텍스트 (~30k chars)
  3) LLM (Claude Haiku 4.5) tool_use 로 정형 데이터 추출:
     - business_summary_kr: 한글 4-6 문장
     - customers: ['Toyota', 'Honda', ...] (정식 영문 OEM 명, 자동차 브랜드만)
     - products: ['하프샤프트', '조향장치', ...] (한글 부품 카테고리)
     - homepage_url: 회사 공식 홈페이지
  4) UPDATE companies SET ... WHERE id = ?

대상:
  --page parts-top100 (default)
  --only-missing (default true): business_summary OR customers 비어있는 회사만
  TARGET_TICKERS env: 콤마 분리 ticker (디버그)
"""
import argparse
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
import anthropic  # noqa: E402

from lib.db import get_client  # noqa: E402

SLUG_MAP_PATH = Path(__file__).parent / 'lib' / 'marklines_slugs.json'
DEFAULT_MODEL = os.environ.get('MODEL', 'claude-haiku-4-5-20251001')
URL_TPL = 'https://www.marklines.com/en/top500/{slug}'

TOOL = {
  'name': 'submit_meta',
  'description': 'Extract company business meta from marklines page text.',
  'input_schema': {
    'type': 'object',
    'properties': {
      'business_summary_kr': {
        'type': 'string',
        'description': (
          '한국어 8-12문장, 약 400-500자의 회사 설명. 다음을 모두 포함: '
          '(1) 설립 연도와 본사 위치, (2) 주요 사업 영역과 부문, '
          '(3) 주력 제품 카테고리, (4) 글로벌 생산/판매 거점, '
          '(5) 주요 고객사 및 시장 위치, (6) 최근 사업 동향·M&A·전략·강점. '
          '국내 상장사 사업보고서 요약체처럼 객관적이고 정보 풍부하게.'
        ),
      },
      'customers': {
        'type': 'array',
        'items': {'type': 'string'},
        'description': '주요 자동차 OEM 고객사 영문 정식명 list (예: Toyota, Honda, Volkswagen, BMW, Hyundai, Tesla). 자동차 브랜드만, 자회사·자동차 외 산업 제외. 최대 12개.',
      },
      'products': {
        'type': 'array',
        'items': {'type': 'string'},
        'description': '주력 자동차 부품 카테고리 한글 list (예: 하프샤프트, 조향장치, 와이어하네스, 배터리, 차체 패널). 최대 8개.',
      },
      'homepage_url': {
        'type': ['string', 'null'],
        'description': '공식 회사 홈페이지 URL (예: https://www.bosch.com/). 페이지에 안 나오면 null.',
      },
    },
    'required': ['business_summary_kr', 'customers', 'products'],
  },
}


def _to_slug(s: str) -> str:
  s = (s or '').lower().strip()
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
    sys.exit('MARKLINES_COOKIE 미설정')
  s = requests.Session()
  s.headers.update({
    'User-Agent': (
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    ),
    'Cookie': cookie,
    'Referer': 'https://www.marklines.com/en/',
  })
  return s


def _extract_page_text(html: str) -> str | None:
  """페이지 상단 카드 + Business Highlights + 회사 본문 텍스트 (~30k chars)."""
  soup = BeautifulSoup(html, 'html.parser')
  for tag in soup(['script', 'style', 'noscript']):
    tag.decompose()
  parts: list[str] = []

  # 1) 상단 정보 카드 (Year Established, Sales Turnover, Address, URL 등)
  for p in soup.find_all('p', class_='company-contents-title'):
    sib = p.find_next_sibling()
    if sib:
      parts.append((p.get_text(' ', strip=True) + ' ' + sib.get_text(' ', strip=True)).strip())

  # 2) Business Highlights + 페이지 후반 (Customer/Operation 등) 50k chars
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
  else:
    # Business Highlights 없는 회사 — 페이지 본문 통째 (paywall 회사용)
    full_text = soup.get_text(' ', strip=True)
    full_text = re.sub(r'\s{2,}', ' ', full_text)
    parts.append(full_text[:30_000])

  text = '\n\n'.join([p for p in parts if p]).strip()
  return text[:30_000] if text else None


def _extract_via_llm(llm, name: str, country: str, text: str) -> dict | None:
  prompt = (
    f"Extract business meta for '{name}' (HQ: {country}) from marklines page text.\n"
    f"Output:\n"
    f"- business_summary_kr: 한국어 8-12 문장, 약 400-500자. 국내 상장사 사업보고서 요약체. "
    f"  설립연도·본사·주요사업·제품·글로벌 거점·주요 고객·M&A·최근 동향·전략 강점 모두 포함.\n"
    f"- customers: 자동차 OEM 영문 정식명만. 부품사·자회사·자동차 외 산업 제외.\n"
    f"- products: 자동차 부품 카테고리 한글 (예: 와이어하네스, 조향장치, 배터리).\n"
    f"- homepage_url: 페이지 'URL' 필드의 값. 없으면 null.\n\n"
    f"--- PAGE TEXT ---\n{text}"
  )
  try:
    resp = llm.messages.create(
      model=DEFAULT_MODEL, max_tokens=2048,
      tools=[TOOL], tool_choice={'type': 'tool', 'name': 'submit_meta'},
      messages=[{'role': 'user', 'content': prompt}],
    )
    for block in resp.content:
      if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_meta':
        return dict(block.input)
    return None
  except Exception as e:
    logger.error(f'  LLM 실패: {e}')
    return None


def main() -> None:
  ap = argparse.ArgumentParser()
  ap.add_argument('--page', default='parts-top100')
  ap.add_argument('--only-missing', action='store_true', default=True)
  ap.add_argument('--all', action='store_true', help='모든 parts-top100 회사 (기존 데이터 덮어쓰기)')
  args = ap.parse_args()

  api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
  if not api_key:
    sys.exit('ANTHROPIC_API_KEY 미설정')

  slug_map = _load_slug_map()
  client = get_client()

  raw = os.environ.get('TARGET_TICKERS', '').strip()
  target_filter = {t.strip() for t in raw.split(',') if t.strip()}

  pages = client.table('company_pages').select('company_id').eq('page', args.page).execute().data
  cids = [p['company_id'] for p in pages]
  rows = (
    client.table('companies').select('id,ticker,name,name_kr,country,business_summary,customers,products,homepage_url')
    .in_('id', cids).eq('status', 'active').execute().data or []
  )

  if target_filter:
    rows = [r for r in rows if r['ticker'] in target_filter]

  if not args.all:
    # 누락 회사만
    rows = [
      r for r in rows
      if not r.get('business_summary')
      or not r.get('customers') or r.get('customers') in ([], None)
      or not r.get('products') or r.get('products') in ([], None)
    ]

  logger.info(f'대상 {len(rows)}개')
  if not rows:
    return

  session = _build_session()
  llm = anthropic.Anthropic(api_key=api_key)

  ok, fail = 0, 0
  for i, c in enumerate(rows, 1):
    ticker = c['ticker']
    slug = slug_map.get(ticker) or _to_slug(c['name'])
    logger.info(f'[{i}/{len(rows)}] [{c["name_kr"]}] slug={slug}')
    try:
      r = session.get(URL_TPL.format(slug=slug), timeout=30, allow_redirects=True)
      if r.status_code != 200 or 'top500' not in r.url:
        logger.warning(f'  HTTP {r.status_code} / redirect')
        fail += 1
        continue
      text = _extract_page_text(r.text)
      if not text or len(text) < 200:
        logger.warning('  텍스트 너무 짧음')
        fail += 1
        continue
      ext = _extract_via_llm(llm, c['name'], c.get('country', ''), text)
      if not ext:
        fail += 1
        continue

      update = {}
      if ext.get('business_summary_kr'):
        update['business_summary'] = ext['business_summary_kr'][:2000]
      if ext.get('customers'):
        update['customers'] = ext['customers'][:12]
      if ext.get('products'):
        update['products'] = ext['products'][:8]
      if ext.get('homepage_url'):
        update['homepage_url'] = ext['homepage_url'][:500]

      if update:
        client.table('companies').update(update).eq('id', c['id']).execute()
        ok += 1
        logger.info(f'  OK customers={len(ext.get("customers", []))} products={len(ext.get("products", []))}')
      else:
        fail += 1
    except Exception as e:
      logger.error(f'  예외: {e}')
      fail += 1
    time.sleep(1)

  logger.info(f'\n완료: {ok}성공 / {fail}실패')

  # Next.js 캐시 무효화 — client.table().update()로 companies 우회 갱신
  try:
    from lib.revalidate import revalidate_for_tables
    revalidate_for_tables(['companies'])
  except Exception as e:
    logger.debug(f'  revalidate skip: {e}')


if __name__ == '__main__':
  main()
