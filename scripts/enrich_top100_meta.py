"""
Top100 회사 메타 정보 보강 — Anthropic Claude web_search tool로
회사 설명·주력 제품·고객사를 추출해 companies UPDATE.

대상: page='parts-top100' 매핑된 회사 중 products 또는 business_summary 가 비어있는 것.
한 회사당 1회 LLM 호출. rate limit (50k tokens/min) 회피 위해 호출 사이 sleep.
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

from lib.db import WriteSession  # noqa: E402
from lib.text import is_rejection_response, strip_citation_tags  # noqa: E402

LOG_PATH = Path(__file__).parent / '_top100_meta_log.json'
DEFAULT_MODEL = os.environ.get('MODEL', 'claude-haiku-4-5-20251001')

ENRICH_TOOL = {
  'name': 'submit_company_meta',
  'description': (
    'Submit the company description, primary products, and major customers. '
    'Be concise (Korean, 1-2 sentences for summary).'
  ),
  'input_schema': {
    'type': 'object',
    'properties': {
      'business_summary': {
        'type': 'string',
        'description': '회사 사업 요약 (한국어, 100~250자, 1-2문장).',
      },
      'products': {
        'type': 'array',
        'description': '주력 제품·서비스 4-6개 (한국어 또는 영문, 짧은 명사구).',
        'items': {'type': 'object', 'properties': {'name': {'type': 'string'}}, 'required': ['name']},
      },
      'customers': {
        'type': 'array',
        'description': '주요 OEM 고객사 3-5개 (한국어 또는 영문, 차종/완성차업체).',
        'items': {'type': 'object', 'properties': {'name': {'type': 'string'}}, 'required': ['name']},
      },
      'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
    },
    'required': ['business_summary', 'products', 'customers', 'confidence'],
  },
}


def _ask_claude(llm, name: str, country: str, name_kr: str) -> dict | None:
  prompt = (
    f"For the automotive supplier '{name}' (Korean: {name_kr}, country: {country}), "
    f"please research and provide:\n"
    f"1) business_summary: 회사 개요 100-250자 한국어 1-2문장 (어떤 부품/시장/특징)\n"
    f"2) products: 주력 제품 4-6개 (한국어 명사구 우선; 예: '브레이크', 'EV 배터리', 'LED 헤드램프')\n"
    f"3) customers: 주요 완성차 OEM 고객사 3-5개 (예: '현대차', '폭스바겐', 'GM')\n"
    f"Use web_search if needed. Then call submit_company_meta with the result."
  )
  try:
    resp = llm.messages.create(
      model=DEFAULT_MODEL,
      max_tokens=4096,
      tools=[
        {'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 3},
        ENRICH_TOOL,
      ],
      messages=[{'role': 'user', 'content': prompt}],
    )
    for block in resp.content:
      if getattr(block, 'type', None) == 'tool_use' and getattr(block, 'name', None) == 'submit_company_meta':
        return dict(block.input)
    return None
  except Exception as e:
    msg = str(e)
    if '429' in msg or 'rate_limit' in msg:
      logger.warning(f'{name}: rate limit — 60s sleep 후 재시도')
      time.sleep(60)
      try:
        resp = llm.messages.create(
          model=DEFAULT_MODEL,
          max_tokens=4096,
          tools=[
            {'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 3},
            ENRICH_TOOL,
          ],
          messages=[{'role': 'user', 'content': prompt}],
        )
        for block in resp.content:
          if getattr(block, 'type', None) == 'tool_use' and getattr(block, 'name', None) == 'submit_company_meta':
            return dict(block.input)
        return None
      except Exception as e2:
        logger.error(f'{name} 재시도 실패: {e2}')
        return None
    logger.error(f'{name} Claude 호출 실패: {e}')
    return None


def main() -> None:
  api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
  if not api_key:
    logger.error('ANTHROPIC_API_KEY 미설정')
    sys.exit(1)

  with WriteSession() as w:
    _main_in_session(w, api_key)


def _main_in_session(w, api_key: str) -> None:
  pages = w.table('company_pages').select('company_id').eq('page', 'parts-top100').execute().data
  cids = [p['company_id'] for p in (pages or [])]
  if not cids:
    logger.warning('parts-top100 매핑 회사 없음')
    return

  companies = (
    w.table('companies')
    .select('id,ticker,name,name_kr,country,products,business_summary,customers')
    .in_('id', cids)
    .eq('status', 'active')
    .execute()
    .data or []
  )

  # products(=[]) 또는 business_summary IS NULL 인 회사만
  targets = [
    c for c in companies
    if (not c.get('products')) or (not c.get('business_summary'))
  ]
  logger.info(f'메타 보강 대상 {len(targets)}/{len(companies)}개')

  import anthropic
  llm = anthropic.Anthropic(api_key=api_key)

  log_entries: list[dict] = []
  updated = 0
  for i, c in enumerate(targets, 1):
    name = c['name']
    name_kr = c['name_kr']
    country = c['country']
    cid = c['id']
    logger.info(f'[{i}/{len(targets)}] {name_kr} ({country})...')

    res = _ask_claude(llm, name, country, name_kr)
    if not res or res.get('confidence') == 'low':
      logger.warning(f'  → 결과 없음 또는 low confidence')
      continue

    bs_clean = strip_citation_tags(res.get('business_summary'))
    if bs_clean and is_rejection_response(bs_clean):
      logger.warning(f'  {name_kr}: business_summary가 거부 응답 — 기존 값 유지')
      bs_clean = None
    update_payload = {
      'business_summary': bs_clean or c.get('business_summary'),
      'products': res.get('products') or c.get('products') or [],
      'customers': res.get('customers') or c.get('customers') or [],
      'summary_updated_at': 'now()',
    }
    # NULL/빈 값은 기존 값 유지 — products는 빈 리스트가 가능하므로 명시 체크
    if res.get('products'):
      update_payload['products'] = res['products']
    if res.get('customers'):
      update_payload['customers'] = res['customers']

    # summary_updated_at은 string 'now()'으로 처리 안 됨 — 그냥 빼고 trigger or default
    update_payload.pop('summary_updated_at', None)

    try:
      w.table('companies').update(update_payload).eq('id', cid).execute()
      updated += 1
      log_entries.append({'name_kr': name_kr, 'company_id': cid, 'data': res})
      logger.info(f'  ✓ products={len(res.get("products") or [])} customers={len(res.get("customers") or [])}')
    except Exception as e:
      logger.error(f'  UPDATE 실패: {e}')

    # rate limit 회피: 호출 사이 5초
    time.sleep(5)

  LOG_PATH.write_text(json.dumps(log_entries, ensure_ascii=False, indent=2), encoding='utf-8')
  logger.info(f'완료: 보강 {updated}/{len(targets)}개')

  # WriteSession.__exit__이 자동으로 revalidate_for_tables(['companies'])를 호출한다.


if __name__ == '__main__':
  main()
