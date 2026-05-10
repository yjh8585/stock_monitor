"""
LLM으로 marklines top100 누락 추정 회사 ↔ 우리 DB 부품사 정확 매칭.

입력:
  - scripts/_marklines_match.json: 매칭 1차 시도 결과 (missing 41개)
  - DB 모든 active 부품사

출력:
  - scripts/_marklines_match_llm.json:
    [{ml_rank, ml_name, ml_slug, our_ticker (또는 null), our_name (또는 null), reason}]
"""
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client  # noqa: E402

import anthropic  # noqa: E402

api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
if not api_key:
  logger.error('ANTHROPIC_API_KEY 미설정')
  sys.exit(1)

# 1차 매칭 결과 로드
match_data = json.load(open(Path(__file__).parent / '_marklines_match.json', encoding='utf-8'))
missing = match_data['missing']
logger.info(f'1차 매칭 누락: {len(missing)}개 marklines 회사')

# DB 모든 active 회사 (부품사 + 기타)
client = get_client()
rows = client.table('companies').select('id,ticker,name,name_kr,country,market').eq('status', 'active').execute().data
db_list = [{'ticker': r['ticker'], 'name': r['name'], 'name_kr': r['name_kr']} for r in rows]
logger.info(f'DB active 회사: {len(db_list)}개')

# LLM tool
TOOL = {
  'name': 'submit_matches',
  'description': 'For each marklines company, identify whether it exists in our DB.',
  'input_schema': {
    'type': 'object',
    'properties': {
      'matches': {
        'type': 'array',
        'items': {
          'type': 'object',
          'properties': {
            'ml_rank': {'type': 'integer'},
            'ml_name': {'type': 'string'},
            'ml_slug': {'type': 'string'},
            'our_ticker': {'type': ['string', 'null']},
            'reason': {'type': 'string'},
          },
          'required': ['ml_rank', 'ml_name', 'ml_slug', 'our_ticker', 'reason'],
        },
      },
    },
    'required': ['matches'],
  },
}

prompt = (
  f"Match each marklines top100 supplier to our DB if it exists.\n\n"
  f"Notes:\n"
  f"- Korean stocks have numeric tickers (018880, 005850, 300750.SZ etc).\n"
  f"- Some companies renamed (e.g., FORVIA = formerly Faurecia, Niterra = formerly NGK Spark Plug).\n"
  f"- Match by core company identity, not minor name changes.\n"
  f"- If marklines mentions a subsidiary that's part of our parent company in DB, match to parent (e.g., 'Aisin (China)' → '7259.T Aisin').\n"
  f"- Return our_ticker = null only if truly absent from our DB.\n"
  f"- reason: brief explanation.\n\n"
  f"=== MARKLINES MISSING ({len(missing)}) ===\n"
  + json.dumps([{'rank': m['rank'], 'name': m['name'], 'slug': m['slug']} for m in missing], ensure_ascii=False)
  + f"\n\n=== OUR DB ({len(db_list)}) ===\n"
  + json.dumps(db_list, ensure_ascii=False)
)

logger.info(f'prompt 크기: {len(prompt):,} chars')

llm = anthropic.Anthropic(api_key=api_key)
resp = llm.messages.create(
  model='claude-haiku-4-5-20251001',
  max_tokens=8192,
  tools=[TOOL],
  tool_choice={'type': 'tool', 'name': 'submit_matches'},
  messages=[{'role': 'user', 'content': prompt}],
)

result = None
for block in resp.content:
  if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_matches':
    result = dict(block.input)
    break

if not result:
  logger.error('LLM 응답에서 tool_use 못 찾음')
  sys.exit(1)

matches = result.get('matches', [])
out = Path(__file__).parent / '_marklines_match_llm.json'
out.write_text(json.dumps(matches, ensure_ascii=False, indent=2), encoding='utf-8')
logger.info(f'결과 저장 → {out}')

# 통계
have = [m for m in matches if m.get('our_ticker')]
new = [m for m in matches if not m.get('our_ticker')]
logger.info(f'우리 DB에 이미 존재: {len(have)}개')
logger.info(f'진짜 신규: {len(new)}개')

print('\n=== 우리 DB에 이미 있음 (slug map 보강 대상) ===')
for m in have:
  print(f'  {m["ml_rank"]:3d}. {m["ml_name"][:40]:40s} → 우리 ticker: {m["our_ticker"]}  ({m.get("reason","")[:50]})')

print('\n=== 진짜 신규 (등록 대상) ===')
for m in new:
  print(f'  {m["ml_rank"]:3d}. {m["ml_name"][:50]:50s} → slug: {m["ml_slug"]}  ({m.get("reason","")[:60]})')
