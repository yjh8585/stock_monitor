"""
LLM으로 marklines top100 진짜 신규 회사 33개의 ticker/상장 여부/data_source 자동 분류.

입력: scripts/_marklines_match_llm.json
출력: scripts/_new_marklines_classified.json
"""
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

import anthropic

api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
if not api_key:
  sys.exit('ANTHROPIC_API_KEY 미설정')

matches = json.load(open(Path(__file__).parent / '_marklines_match_llm.json', encoding='utf-8'))
new = [m for m in matches if not m.get('our_ticker')]

# LLM 1차 매칭 false positive 보정 — 사용자 직접 확인 케이스
# rank 80 SL Corporation은 우리 005850 (에스엘), rank 68 LS Automotive와는 별도
# 이는 등록 후 사용자가 검증
logger.info(f'분류 대상 신규: {len(new)}개')

TOOL = {
  'name': 'submit_classification',
  'description': 'Classify each company by listing status, primary stock ticker, market, country, and data_source.',
  'input_schema': {
    'type': 'object',
    'properties': {
      'companies': {
        'type': 'array',
        'items': {
          'type': 'object',
          'properties': {
            'ml_rank': {'type': 'integer'},
            'name': {'type': 'string', 'description': 'Standard English name'},
            'name_kr': {'type': 'string', 'description': '한글 회사명'},
            'is_listed': {'type': 'boolean'},
            'ticker': {'type': 'string', 'description': 'Primary listing ticker (e.g., 5334.T, NVDA, MBLY, 0425.HK). For unlisted, use English company short name.'},
            'market': {'type': ['string', 'null'], 'description': 'Exchange code (NASDAQ, NYSE, TSE, HKEX, NSE, SSE, SZSE, XETRA, BME, BIT, PAR, BMV, TSX, KOSPI). null for unlisted.'},
            'country': {'type': 'string', 'description': '2-letter ISO (DE, JP, US, CN, IN, KR, TH, AT, ES, etc)'},
            'currency': {'type': 'string', 'description': '3-letter ISO (EUR/USD/JPY/CNY/INR/THB/KRW etc)'},
            'data_source': {'type': 'string', 'enum': ['yfinance', 'fnguide', 'pykrx+dart', 'marklines'], 'description': 'yfinance for global stocks, fnguide for KR KOSPI, pykrx+dart for KR with DART filings, marklines for unlisted'},
            'company_type': {'type': 'string', 'enum': ['부품사', 'OEM', '소재', '반도체', '소프트웨어'], 'description': 'Korean classification'},
          },
          'required': ['ml_rank', 'name', 'name_kr', 'is_listed', 'ticker', 'market', 'country', 'currency', 'data_source', 'company_type'],
        },
      },
    },
    'required': ['companies'],
  },
}

prompt = (
  f"Classify these {len(new)} marklines top100 automotive companies. For each:\n"
  f"- Determine if PUBLICLY LISTED (any major exchange) or PRIVATE.\n"
  f"- If listed: give the primary ticker (Yahoo Finance format). E.g., Niterra=5334.T, NVIDIA=NVDA, Mobileye=MBLY, "
  f"  Minth Group=0425.HK, UNO Minda=MINDAIND.NS, Hanon Systems=018880 (KR has 6-digit numeric).\n"
  f"- If private: ticker = short English name (no spaces, e.g., 'Hella', 'Ficosa').\n"
  f"- data_source: yfinance for non-KR listed; fnguide for KR KOSPI listed; marklines for private.\n"
  f"- name_kr in Korean (e.g., NVIDIA→엔비디아, Mobileye→모빌아이, Hella→헬라).\n"
  f"- All entries here are 부품사 (auto parts), with possible 반도체 for NVIDIA/Mobileye/Pioneer/Inovance.\n\n"
  f"=== INPUT ===\n"
  + json.dumps([{'rank': m['ml_rank'], 'name': m['ml_name'], 'slug': m['ml_slug']} for m in new], ensure_ascii=False)
)

logger.info(f'prompt: {len(prompt):,} chars')
llm = anthropic.Anthropic(api_key=api_key)
resp = llm.messages.create(
  model='claude-haiku-4-5-20251001', max_tokens=8192,
  tools=[TOOL], tool_choice={'type': 'tool', 'name': 'submit_classification'},
  messages=[{'role': 'user', 'content': prompt}],
)

result = None
for block in resp.content:
  if getattr(block, 'type', None) == 'tool_use' and block.name == 'submit_classification':
    result = dict(block.input)
    break
if not result:
  sys.exit('LLM 응답 tool_use 없음')

companies = result.get('companies', [])
out = Path(__file__).parent / '_new_marklines_classified.json'
out.write_text(json.dumps(companies, ensure_ascii=False, indent=2), encoding='utf-8')
logger.info(f'저장 → {out}')

print('\n=== 분류 결과 ===')
print(f'{"rank":4s} {"is_listed":10s} {"ticker":18s} {"market":10s} {"country":3s} {"data_source":15s} name_kr')
for c in companies:
  is_l = '상장' if c.get('is_listed') else '비상장'
  print(f'  {c["ml_rank"]:3d} {is_l:10s} {c["ticker"][:18]:18s} {(c.get("market") or "-")[:10]:10s} {c["country"][:3]:3s} {c["data_source"][:15]:15s} {c.get("name_kr","")} ({c["name"][:30]})')
