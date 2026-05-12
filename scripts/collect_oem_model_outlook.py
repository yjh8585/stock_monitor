#!/usr/bin/env python3
"""북미 핵심 차종 5종의 소비자 평가·판매전망을 Claude로 종합해 oem_model_outlook에 적재.

차종(모델별 최근 뉴스 헤드라인 + 모회사 ticker 헤드라인 + 8-K 미사용) → Haiku 4.5 → JSON.

매주 월요일 06:30 KST에 .github/workflows/collect-oem-model-outlook.yml가 호출.
중복 실행은 (model_key, note_date) PK upsert로 안전 (멱등).

연간 비용 (Claude Haiku 4.5):
  - 5개 차종 × 주 1회 × 52주 = 260 호출
  - 1회당 입력 ~2K tokens × $1/M + 출력 ~500 tokens × $5/M ≈ $0.0045
  - 연간 ≈ $1.2 (약 1,600원)
"""
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import yfinance as yf
from anthropic import Anthropic
from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

sys.path.insert(0, str(Path(__file__).parent))
from lib.db import upsert_rows  # noqa: E402

ANTHROPIC_MODEL = os.environ.get('OEM_MODEL_OUTLOOK_MODEL', 'claude-haiku-4-5-20251001')
NEWS_LIMIT = 8
KST = timezone(timedelta(hours=9))

# 사용자 지정 5개 차종 (app/oem/page.tsx의 NA_MODEL_TARGETS와 일치)
MODELS = [
  {
    'key': 'grand_cherokee',
    'name': 'Jeep Grand Cherokee',
    'oem_group': 'Stellantis',
    'parent_ticker': 'STLA',
    'search_terms': ['Jeep Grand Cherokee', 'Grand Cherokee SUV'],
  },
  {
    'key': 'ram_truck',
    'name': 'Ram Pickup (1500/2500/3500)',
    'oem_group': 'Stellantis',
    'parent_ticker': 'STLA',
    'search_terms': ['Ram 1500', 'Ram pickup truck'],
  },
  {
    'key': 'pacifica',
    'name': 'Chrysler Pacifica',
    'oem_group': 'Stellantis',
    'parent_ticker': 'STLA',
    'search_terms': ['Chrysler Pacifica', 'Pacifica minivan'],
  },
  {
    'key': 'rivian_r1',
    'name': 'Rivian R1T / R1S',
    'oem_group': 'Rivian',
    'parent_ticker': 'RIVN',
    'search_terms': ['Rivian R1T', 'Rivian R1S'],
  },
  {
    'key': 'atlas',
    'name': 'Volkswagen Atlas',
    'oem_group': 'Volkswagen',
    'parent_ticker': 'VWAGY',
    'search_terms': ['VW Atlas', 'Volkswagen Atlas SUV'],
  },
]


def _fetchYfNews(ticker: str) -> list[dict]:
  """yfinance 뉴스 헤드라인 N개 (collect_macro_outlook.py와 동일 패턴)."""
  try:
    raw = yf.Ticker(ticker).news or []
  except Exception as e:
    logger.warning(f"{ticker}: yfinance.news 실패 — {e}")
    return []

  rows = []
  for item in raw[:NEWS_LIMIT]:
    content = item.get('content') if isinstance(item.get('content'), dict) else item
    title = content.get('title') or item.get('title')
    publisher = (
      content.get('provider', {}).get('displayName')
      if isinstance(content.get('provider'), dict)
      else content.get('publisher') or item.get('publisher')
    )
    pub_date = (
      content.get('pubDate')
      or content.get('providerPublishTime')
      or item.get('providerPublishTime')
    )
    if isinstance(pub_date, int):
      pub_date = datetime.fromtimestamp(pub_date, tz=timezone.utc).isoformat()
    if not title:
      continue
    rows.append({'title': title, 'publisher': publisher, 'pubDate': pub_date})
  return rows


def _buildDigest(model: dict, news: list[dict]) -> str:
  """차종 1개에 대한 Claude 프롬프트용 컨텍스트 구성."""
  news_lines = [
    f"  - [{(n.get('pubDate') or '')[:10]}] {n['title']} ({n.get('publisher') or '-'})"
    for n in news
  ] or ['  - (최근 뉴스 헤드라인 없음)']
  return (
    f"차종: {model['name']}\n"
    f"제조사: {model['oem_group']} (parent ticker: {model['parent_ticker']})\n"
    f"키워드: {', '.join(model['search_terms'])}\n\n"
    f"[모회사 최근 뉴스 헤드라인]\n" + '\n'.join(news_lines)
  )


def _evaluateModel(client: Anthropic, model: dict, digest: str) -> dict | None:
  """차종 1개의 평가 JSON을 생성한다."""
  prompt = f"""당신은 북미 자동차 시장 애널리스트입니다. 아래는 특정 차종과 그 제조사의 최근 뉴스 헤드라인입니다.

이 정보와 당신이 알고 있는 일반적인 시장 지식을 종합해 **북미(미국) 시장에서 이 차종에 대한 평가**를 한국어로 작성하세요.

## 응답 형식 (반드시 JSON. 코드펜스 금지)

{{
  "label": "GREEN | YELLOW | RED",
  "consumer_view": "소비자 평가 요약 — 강점, 약점, 리뷰 트렌드. 2~3줄.",
  "outlook": "판매전망 요약 — 단기/중기 수요 방향, 경쟁 차종, 재고/가격 압력. 2~3줄.",
  "rationale": "label을 그렇게 정한 핵심 근거. 1~2줄."
}}

## label 기준 (종합 판단)
- **GREEN**: 소비자 평가 우호적 + 판매 모멘텀 견조. 단기 전망도 긍정.
- **YELLOW**: 평가는 무난하나 경쟁 심화·가격 압력·세대교체 임박 등 신중 신호.
- **RED**: 평가 악화·판매 둔화·리콜/품질 이슈·세그먼트 축소 등 부정 신호 지배적.

## 작성 지침
- 한국어로 작성, 회사명·차종명은 원문 그대로(예: "Jeep Grand Cherokee").
- 추측 단정 금지 ("…것으로 추정된다", "…로 보인다" 등 완곡 표현 활용).
- 헤드라인에 직접 언급이 없어도, 차종의 일반적 시장 위치를 기반으로 판단.

[입력 데이터]
{digest}
"""
  try:
    msg = client.messages.create(
      model=ANTHROPIC_MODEL,
      max_tokens=1500,
      messages=[{'role': 'user', 'content': prompt}],
    )
    raw = msg.content[0].text if msg.content else ''
  except Exception as e:
    logger.error(f"{model['key']}: Claude 호출 실패 — {e}")
    return None

  text = raw.strip()
  if text.startswith('```'):
    text = text.split('```', 2)[1]
    if text.startswith('json'):
      text = text[4:]
    text = text.strip('` \n')
  try:
    parsed = json.loads(text)
    label = (parsed.get('label') or '').strip().upper()
    if label not in ('GREEN', 'YELLOW', 'RED'):
      logger.warning(f"{model['key']}: label={label!r} 잘못됨 — YELLOW로 fallback")
      label = 'YELLOW'
    return {
      'label': label,
      'consumer_view': (parsed.get('consumer_view') or '').strip(),
      'outlook': (parsed.get('outlook') or '').strip(),
      'rationale': (parsed.get('rationale') or '').strip(),
    }
  except json.JSONDecodeError as e:
    logger.error(f"{model['key']}: JSON 파싱 실패 — {e} / raw={raw[:300]}")
    return None


def collectOemModelOutlook() -> int:
  api_key = os.environ.get('ANTHROPIC_API_KEY')
  if not api_key:
    logger.error('ANTHROPIC_API_KEY 환경변수 미설정')
    return 1
  client = Anthropic(api_key=api_key)
  today = datetime.now(KST).date().isoformat()

  rows = []
  for model in MODELS:
    logger.info(f"{model['key']} ({model['name']}) 평가 시작")
    news = _fetchYfNews(model['parent_ticker'])
    digest = _buildDigest(model, news)
    result = _evaluateModel(client, model, digest)
    if not result:
      logger.warning(f"{model['key']}: 평가 실패 — 스킵")
      continue
    rows.append({
      'model_key': model['key'],
      'model_name': model['name'],
      'oem_group': model['oem_group'],
      'region': 'North America',
      'note_date': today,
      'label': result['label'],
      'consumer_view': result['consumer_view'],
      'outlook': result['outlook'],
      'rationale': result['rationale'],
      'sources_used': f"yfinance.{model['parent_ticker']}.news×{len(news)}",
    })
    logger.success(f"{model['key']}: {result['label']}")

  if not rows:
    logger.error('적재할 행 없음')
    return 1

  upsert_rows('oem_model_outlook', rows, conflict_cols='model_key,note_date')
  logger.success(f"{today} {len(rows)}개 차종 평가 적재 완료")
  return 0


if __name__ == '__main__':
  try:
    sys.exit(collectOemModelOutlook())
  except Exception as e:
    logger.error(f"oem_model_outlook 수집 실패: {e}")
    sys.exit(1)
