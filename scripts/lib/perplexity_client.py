"""Perplexity Search API 클라이언트.

Claude 내장 웹검색 대신 이걸 쓰는 이유: 검색어를 우리가 고정할 수 있어 매주 같은 관점의
최신 결과가 보장된다(모델 자율 검색은 주마다 검색어가 달라져 편차가 크다). 가격도 절반
($5/1,000 vs $10/1,000).

엔드포인트: POST https://api.perplexity.ai/search
응답: {'id': ..., 'results': [{'title','url','date','last_updated','snippet'}, ...]}
키: PERPLEXITY_API_KEY (scripts/.env · .env.local · GitHub Secrets)
"""
import os

import requests
from loguru import logger

API_URL = 'https://api.perplexity.ai/search'
TIMEOUT = 40
SNIPPET_LIMIT = 700


def build_model_queries(model_name: str, competitors: list[str]) -> list[str]:
  """차종 1개에 대한 고정 검색어 3종 — 신형/소비자/경쟁 관점."""
  rivals = ' OR '.join(competitors[:3]) if competitors else 'competitors'
  return [
    f'{model_name} redesign OR facelift OR next generation 2026 2027',
    f'{model_name} owner complaints reliability review 2026',
    f'{model_name} vs {rivals} comparison sales 2026',
  ]


def parse_search_response(raw: dict, snippet_limit: int = SNIPPET_LIMIT) -> list[dict]:
  """API 응답 → 프롬프트에 넣을 최소 필드만. 스니펫은 토큰 절약을 위해 자른다."""
  out = []
  for item in (raw or {}).get('results') or []:
    title = (item.get('title') or '').strip()
    url = (item.get('url') or '').strip()
    if not title or not url:
      continue
    out.append({
      'title': title,
      'url': url,
      'date': (item.get('date') or item.get('last_updated') or '')[:10],
      'snippet': (item.get('snippet') or '').strip()[:snippet_limit],
    })
  return out


def search(query: str, *, max_results: int = 5, recency_days: int | None = None) -> list[dict]:
  """검색 1회. 실패는 빈 리스트로 흡수한다(웹 결과가 없어도 평가 자체는 진행).

  recency 필터는 API가 받지 않아 미사용. 최신성은 검색어의 연도 표기로 확보한다(예: '2026 2027').
  """
  key = os.environ.get('PERPLEXITY_API_KEY')
  if not key:
    logger.warning('PERPLEXITY_API_KEY 미설정 — 웹 검색 건너뜀')
    return []
  payload: dict = {'query': query, 'max_results': max_results, 'max_tokens_per_page': 512}
  try:
    r = requests.post(
      API_URL,
      headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
      json=payload,
      timeout=TIMEOUT,
    )
  except requests.RequestException as e:
    logger.warning(f'Perplexity 호출 실패 — {e}')
    return []
  if r.status_code != 200:
    logger.warning(f'Perplexity HTTP {r.status_code} — {r.text[:200]}')
    return []
  return parse_search_response(r.json())
