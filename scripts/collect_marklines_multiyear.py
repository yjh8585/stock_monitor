"""marklines 페이지에서 다년치 매출/EBIT 추출 — Business Highlights 표 활용.

기존 collect_marklines_direct.py는 가장 최근 1년만 추출.
이 스크립트는 페이지의 Financial Overview / Sales 표 전체 (보통 3-5년치)를 LLM에 부탁해 다년치 한 번에 upsert.

사용:
  TARGET_TICKERS="5191.T,601501.SS,..." python scripts/collect_marklines_multiyear.py
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
import anthropic  # noqa: E402

from lib.db import get_client, upsert_rows  # noqa: E402

SLUG_MAP_PATH = Path(__file__).parent / 'lib' / 'marklines_slugs.json'
DEFAULT_MODEL = os.environ.get('MODEL', 'claude-haiku-4-5-20251001')
URL_TPL = 'https://www.marklines.com/en/top500/{slug}'

TOOL = {
  'name': 'submit_multi_year',
  'description': 'Submit multi-year annual financials extracted from marklines Financial Overview table.',
  'input_schema': {
    'type': 'object',
    'properties': {
      'currency': {'type': 'string', 'description': 'ISO 3-letter (EUR/USD/JPY/CNY/INR/etc) from table header'},
      'unit': {'type': 'string', 'enum': ['unit', 'thousand', 'million', 'billion']},
      'years': {
        'type': 'array',
        'items': {
          'type': 'object',
          'properties': {
            'fiscal_year': {'type': 'integer', 'description': 'e.g., 2024 for "FY ended Dec 2024"'},
            'period_end_month': {'type': 'integer', 'description': 'fiscal year end month (1-12). e.g., 12 for Dec, 3 for March'},
            'revenue': {'type': ['number', 'null']},
            'operating_income': {'type': ['number', 'null'], 'description': 'EBIT or Operating Income same unit/currency'},
            'net_income': {'type': ['number', 'null']},
          },
          'required': ['fiscal_year', 'period_end_month', 'revenue'],
        },
      },
      'source_quote': {'type': 'string'},
    },
    'required': ['currency', 'unit', 'years', 'source_quote'],
  },
}

UNIT_TO_MILLION = {'unit': 1.0/1_000_000.0, 'thousand': 0.001, 'million': 1.0, 'billion': 1000.0}


def _to_slug(s):
  s = (s or '').lower().strip()
  s = re.sub(r'[^a-z0-9]+', '-', s)
  return re.sub(r'-+', '-', s).strip('-')


def _extract_text(html):
  soup = BeautifulSoup(html, 'html.parser')
  for tag in soup(['script', 'style', 'noscript']):
    tag.decompose()
  parts = []
  # 상단 카드
  for p in soup.find_all('p', class_='company-contents-title'):
    sib = p.find_next_sibling()
    if sib:
      parts.append((p.get_text(' ', strip=True) + ' ' + sib.get_text(' ', strip=True)).strip())
  # Business Highlights 부터 100k chars (Data 섹션 표 포함)
  start = html.find('<h2 id="highlight"')
  if start >= 0:
    section_html = html[start:start+100_000]
    ssoup = BeautifulSoup(section_html, 'html.parser')
    for tag in ssoup(['script', 'style', 'noscript']):
      tag.decompose()
    section_text = ssoup.get_text(' ', strip=True)
    section_text = re.sub(r'\s{2,}', ' ', section_text)
    parts.append(section_text)
  # 페이지의 모든 table (수치 포함)
  table_chunks = []
  for table in soup.find_all('table'):
    t = table.get_text(' ', strip=True)
    t = re.sub(r'\s{2,}', ' ', t)
    if t and re.search(r'\d{1,3}(?:,\d{3})+', t):
      hdr = ''
      m = re.search(r'\(in\s+([A-Z]{3}\s+(?:million|billion|thousand))\)', t, re.I)
      if m: hdr = f' [{m.group(1)}]'
      table_chunks.append(f'TABLE{hdr}: {t[:3000]}')
  if table_chunks:
    parts.append('\n--- ALL TABLES ---\n' + '\n\n'.join(table_chunks[:10]))
  text = '\n\n'.join(parts).strip()
  return text[:80_000] if text else None


def main():
  api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
  if not api_key: sys.exit('ANTHROPIC_API_KEY 미설정')
  cookie = os.environ.get('MARKLINES_COOKIE', '').strip()
  if not cookie: sys.exit('MARKLINES_COOKIE 미설정')

  raw = os.environ.get('TARGET_TICKERS', '').strip()
  tickers = [t.strip() for t in raw.split(',') if t.strip()]
  if not tickers: sys.exit('TARGET_TICKERS 필요')

  client = get_client()
  rows = client.table('companies').select('id,ticker,name,name_kr,country').in_('ticker', tickers).execute().data
  if not rows: sys.exit('회사 없음')
  logger.info(f'대상 {len(rows)}개')

  slug_map = json.loads(SLUG_MAP_PATH.read_text(encoding='utf-8'))
  slug_map = {k: v for k, v in slug_map.items() if not k.startswith('_')}

  session = requests.Session()
  session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Cookie': cookie,
    'Referer': 'https://www.marklines.com/en/',
  })
  llm = anthropic.Anthropic(api_key=api_key)

  upserts = []
  for c in rows:
    slug = slug_map.get(c['ticker']) or _to_slug(c['name'])
    logger.info(f'[{c["name_kr"]}] slug={slug}')
    try:
      r = session.get(URL_TPL.format(slug=slug), timeout=30)
      if r.status_code != 200:
        logger.warning(f'  HTTP {r.status_code}')
        continue
      text = _extract_text(r.text)
      if not text:
        logger.warning('  텍스트 없음')
        continue

      prompt = (
        f"Extract ALL fiscal years from marklines Financial Overview / Sales table for '{c['name']}' ({c['country']}).\n"
        f"Rules:\n"
        f"1. Look for table with multi-year columns (e.g., FY2022 / FY2023 / FY2024).\n"
        f"2. Extract every year shown in the main 'Overall' / 'Net Sales' / 'Total' / 'Group' / 'Sales' row.\n"
        f"3. Report values AS PRINTED. Currency and unit from table header (e.g., '(in million EUR)' / '(in KRW billion)').\n"
        f"4. Numbers in (parentheses) = negative loss values.\n"
        f"5. period_end_month: usually 12 (Dec), but Japan often 3 (March), some 9 (Sep).\n"
        f"6. EBIT/Operating Income may be in same or separate row. Optional.\n"
        f"7. CRITICAL UNIT CHECK — verify the unit is exactly one of: unit / thousand / million / billion.\n"
        f"   - If Japanese 億 (oku, =100 million), normalize to million by multiplying raw value by 100.\n"
        f"   - Sanity check: a typical large auto supplier reports tens of billions EUR or trillions JPY.\n"
        f"     If extracted value seems 10x too large (e.g., ZF 380,970 instead of 38,097 with 'million' unit),\n"
        f"     re-examine the header — header might say 'billion' or 'oku' rather than 'million'.\n"
        f"8. Sanity bound: revenue values must satisfy 0 < value < 1e9 in the chosen unit;\n"
        f"   if outside this range, the unit is likely wrong — pick the correct unit.\n"
        f"--- PAGE TEXT ---\n{text}"
      )
      resp = llm.messages.create(
        model=DEFAULT_MODEL, max_tokens=4096,
        tools=[TOOL], tool_choice={'type': 'tool', 'name': 'submit_multi_year'},
        messages=[{'role': 'user', 'content': prompt}],
      )
      ext = None
      for block in resp.content:
        if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_multi_year':
          ext = dict(block.input); break
      if not ext or not ext.get('years'):
        logger.warning('  LLM 추출 실패')
        continue

      mult = UNIT_TO_MILLION.get((ext.get('unit') or 'million').lower(), 1.0)
      currency = (ext.get('currency') or 'EUR').upper()
      cnt = 0
      for y in ext['years']:
        rev = y.get('revenue')
        if rev is None: continue
        try: rev_v = float(rev) * mult
        except (TypeError, ValueError): continue
        if rev_v <= 0 or rev_v > 1_000_000_000: continue
        op = y.get('operating_income')
        try: op_v = float(op) * mult if op is not None else None
        except (TypeError, ValueError): op_v = None
        ni = y.get('net_income')
        try: ni_v = float(ni) * mult if ni is not None else None
        except (TypeError, ValueError): ni_v = None
        fy = int(y['fiscal_year'])
        end_month = int(y.get('period_end_month') or 12)
        # 미래 날짜 skip
        from datetime import date
        from calendar import monthrange
        last_day = monthrange(fy, end_month)[1]
        period_end = f'{fy}-{end_month:02d}-{last_day:02d}'
        if date.fromisoformat(period_end) > date.today():
          continue
        upserts.append({
          'company_id': c['id'],
          'period_type': 'annual',
          'fiscal_year': fy,
          'fiscal_quarter': None,
          'period_end_date': period_end,
          'currency': currency,
          'revenue': round(rev_v, 4),
          'operating_income': round(op_v, 4) if op_v is not None else None,
          'net_income': round(ni_v, 4) if ni_v is not None else None,
        })
        cnt += 1
      logger.info(f'  ✓ {cnt}년 추출 ({currency} {ext.get("unit")})')
      time.sleep(2)
    except Exception as e:
      logger.error(f'  예외: {e}')

  if upserts:
    upsert_rows('financials', upserts, 'company_id,period_type,fiscal_year,fiscal_quarter')
    logger.info(f'\n{len(upserts)}행 upsert 완료')


if __name__ == '__main__':
  main()
