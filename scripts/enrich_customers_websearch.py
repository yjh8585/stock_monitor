"""customers가 비어있는 parts-top100/domestic 회사들의 고객사를 LLM web_search로 보강.

용도:
  ▶ 정기 갱신 / 자동화 (GitHub Actions, cron) 환경 전용 — Anthropic API key 필요.
  ▶ 인터랙티브 작업은 scripts/list_empty_customers.py + Claude Code 어시스턴트 권장 (API 비용 0).

흐름 (회사별):
  1. customers 빈 회사 list 추출
  2. Claude messages.create + web_search_20250305 tool로 회사 OEM 고객사 검색
  3. submit_customers tool 결과 → normalize_customer_name SQL 호출
  4. DB UPDATE

대상: TARGET_TICKERS env 또는 모든 parts-top100/domestic 빈 customers 회사

🔴 결과를 그대로 믿지 말 것(2026-11-10 실측, Sonnet 5.5): 남은 대상은 공개 고객 정보가 없는
   국내 소형 부품사 6곳이었다. 3곳은 「추출 실패」였고 3곳은 출처로 확인되지 않는 OEM 명단
   (예: 국내 2차 협력사에 벤츠·BMW·테슬라 등 12곳)을 냈다. 그래서 3곳 모두 원래 값([])으로 되돌렸다.
   돌렸으면 회사마다 기사·공시로 대조한 뒤에만 남긴다.
"""
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

import anthropic
from lib.db import get_client

DEFAULT_MODEL = os.environ.get('MODEL', 'claude-haiku-4-5-20251001')
WEB_SEARCH = {'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 3}

SUBMIT = {
  'name': 'submit_customers',
  'description': 'Submit confirmed automotive OEM customers (final automaker brands only).',
  'input_schema': {
    'type': 'object',
    'properties': {
      'customers': {
        'type': 'array',
        'items': {'type': 'string'},
        'description': '주요 자동차 OEM 영문 정식명 또는 한글명. 자동차 완성차 브랜드만 (부품사·자회사·자동차 외 산업 제외). 최대 12개.',
      },
    },
    'required': ['customers'],
  },
}


def main():
  api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
  if not api_key:
    sys.exit('ANTHROPIC_API_KEY 미설정')

  client = get_client()
  raw = os.environ.get('TARGET_TICKERS', '').strip()
  filter_set = {t.strip() for t in raw.split(',') if t.strip()}

  pages = client.table('company_pages').select('company_id,page').in_(
    'page', ['parts-top100', 'domestic']).execute().data
  cids = {p['company_id'] for p in pages}
  rows = client.table('companies').select('id,ticker,name,name_kr,country,homepage_url,customers') \
    .in_('id', list(cids)).eq('status', 'active').execute().data
  rows = [r for r in rows if not r.get('customers') or len(r.get('customers') or []) == 0]
  if filter_set:
    rows = [r for r in rows if r['ticker'] in filter_set]
  logger.info(f'대상 {len(rows)}개')

  llm = anthropic.Anthropic(api_key=api_key)
  ok, fail = 0, 0
  for i, c in enumerate(rows, 1):
    logger.info(f'[{i}/{len(rows)}] {c["name_kr"]} ({c["ticker"]})')
    prompt = (
      f"Identify top automotive OEM customers (final automakers/car brands) for "
      f"'{c['name']}' (Korean: {c['name_kr']}, country: {c.get('country','')}). "
      f"Search the web for recent (2024-2025) supply contracts and customer lists. "
      f"Return final automaker brand names only (e.g., Toyota, BMW, GM, Hyundai). "
      f"Exclude tier-1 parts suppliers and non-automotive industries. "
      f"Then call submit_customers."
    )
    try:
      resp = llm.messages.create(
        model=DEFAULT_MODEL, max_tokens=4096,
        tools=[WEB_SEARCH, SUBMIT],
        tool_choice={'type': 'auto'},
        messages=[{'role': 'user', 'content': prompt}],
      )
      ext = None
      for block in resp.content:
        if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_customers':
          ext = dict(block.input)
          break
      if not ext or not ext.get('customers'):
        logger.warning('  LLM 추출 실패')
        fail += 1
        continue

      raw_customers = ext['customers'][:12]
      # SQL normalize_customer_name 호출
      norm_rows = client.rpc('normalize_customer_name', {'raw': ''}).execute()  # warm-up
      normalized = []
      for name in raw_customers:
        try:
          r = client.rpc('normalize_customer_name', {'raw': name}).execute()
          v = r.data
          if v and v not in normalized:
            normalized.append(v)
        except Exception:
          if name and name not in normalized:
            normalized.append(name)

      if normalized:
        # 🔴 트리거 trg_normalize_customers 는 [{"name": ...}] 객체 배열만 읽는다.
        #    문자열 배열을 넘기면 이름을 못 꺼내 조용히 [] 로 저장된다(2026-11-10 실측).
        client.table('companies').update(
          {'customers': [{'name': n} for n in normalized]}).eq('id', c['id']).execute()
        ok += 1
        logger.info(f'  ✓ {len(normalized)}개: {normalized[:5]}')
      else:
        fail += 1
      time.sleep(1)
    except Exception as e:
      logger.error(f'  예외: {e}')
      fail += 1

  logger.info(f'\n완료 {ok}성공 / {fail}실패')


if __name__ == '__main__':
  main()
