#!/usr/bin/env python3
"""
naver_board_posts 중 board_sentiment에 없는 글들을 Claude Haiku로 감성 분석.

분류 기준:
- positive: 매수/호재(흑자·턴어라운드·상한가)/응원/배당 호평
- negative: 손절/비관(폭락·적자·상폐)/비판/조롱
- neutral: 잡담/질문/도배/무관 토론

CLI:
- --mode pending (기본): board_sentiment에 없는 글만
- --mode all          : naver_board_posts 전체 (이미 분석된 글은 ON CONFLICT로 갱신)
- --limit N           : 한 번에 처리할 최대 건수 (기본 200)
- --batch N           : 한 API 호출당 글 수 (기본 20)

비용 (claude-haiku-4-5 기준 추정): 20건 배치 1회 약 $0.0002.
1000건 ≈ $0.01.
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env.local')

from lib.db import get_client, upsert_rows

MODEL = 'claude-haiku-4-5'
DEFAULT_BATCH = 20
DEFAULT_LIMIT = 200
MAX_TOKENS = 4096
ALLOWED_LABELS = {'positive', 'negative', 'neutral'}


def _get_client_anthropic():
  try:
    from anthropic import Anthropic
  except ImportError:
    logger.error('anthropic 패키지 미설치 — `uv pip install anthropic` 또는 pip')
    sys.exit(1)
  api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
  if not api_key:
    logger.error('ANTHROPIC_API_KEY 미설정 — .env.local 또는 scripts/.env 확인')
    sys.exit(1)
  return Anthropic(api_key=api_key)


def _load_pending(mode: str, limit: int) -> list[dict]:
  """board_sentiment에 없는(또는 mode=all이면 전체) post 가져오기."""
  client = get_client()
  if mode == 'all':
    res = (
      client.table('naver_board_posts')
      .select('company_id,post_id,title')
      .order('posted_at', desc=True)
      .limit(limit)
      .execute()
    )
    return res.data or []
  # pending: 좌측 outer join 대신, naver_board_posts에서 가져온 뒤
  # board_sentiment에 이미 있는 (company_id, post_id) 제외.
  # PostgREST는 join 결과로 NULL 필터링이 까다로워 두 단계로 처리.
  res = (
    client.table('naver_board_posts')
    .select('company_id,post_id,title')
    .order('posted_at', desc=True)
    .limit(limit * 3)  # 분석된 글 비율을 감안해 여유
    .execute()
  )
  posts = res.data or []
  if not posts:
    return []
  # board_sentiment에 있는 (company_id, post_id) 집합 만들기
  cids = list({p['company_id'] for p in posts})
  pids = list({p['post_id'] for p in posts})
  sres = (
    client.table('board_sentiment')
    .select('company_id,post_id')
    .in_('company_id', cids)
    .in_('post_id', pids)
    .execute()
  )
  done = {(r['company_id'], r['post_id']) for r in (sres.data or [])}
  pending = [p for p in posts if (p['company_id'], p['post_id']) not in done]
  return pending[:limit]


SYSTEM_PROMPT = (
  '당신은 한국 주식 종목토론실 글 제목의 감성을 분석하는 도구입니다.\n'
  '입력은 글 목록이며, 각 글의 (post_id, 제목)이 주어집니다.\n'
  '\n'
  '분류 기준:\n'
  '- positive: 매수 권유, 호재(흑자·턴어라운드·상한가·실적개선), 응원, 배당 호평\n'
  '- negative: 손절, 비관(폭락·적자·상폐·신저가), 경영진 비판, 조롱\n'
  '- neutral: 잡담, 질문, 무관 토론, 도배, 종목과 무관한 시사글\n'
  '\n'
  'score는 -1.0~1.0 (negative ↔ positive). neutral은 0.0 근처.\n'
  'reason은 한국어 5~10자 핵심 키워드(예: "어닝쇼크", "흑자 전환", "잡담").\n'
  '\n'
  '응답은 JSON 배열만 반환. 코드블록·주석·여분 텍스트 금지.\n'
  '형식: [{"post_id": "...", "label": "positive|negative|neutral", "score": 0.0, "reason": "..."}]\n'
)


def _build_user_prompt(batch: list[dict]) -> str:
  lines = ['[글 목록]']
  for i, p in enumerate(batch, 1):
    title = (p.get('title') or '').replace('\n', ' ').strip()[:200]
    lines.append(f'{i}. (post_id={p["post_id"]}) {title}')
  return '\n'.join(lines)


_JSON_FENCE_RE = re.compile(r'^```(?:json)?\s*|\s*```$', re.MULTILINE)


def _parse_response(text: str) -> list[dict]:
  text = _JSON_FENCE_RE.sub('', text).strip()
  try:
    arr = json.loads(text)
  except json.JSONDecodeError as e:
    logger.warning(f'JSON 파싱 실패: {e} — 응답 앞부분: {text[:200]!r}')
    return []
  if not isinstance(arr, list):
    return []
  out = []
  for it in arr:
    if not isinstance(it, dict):
      continue
    label = str(it.get('label', '')).strip().lower()
    if label not in ALLOWED_LABELS:
      continue
    try:
      score = float(it.get('score', 0.0))
    except (TypeError, ValueError):
      score = 0.0
    score = max(-1.0, min(1.0, score))
    out.append({
      'post_id': str(it.get('post_id', '')),
      'label': label,
      'score': score,
      'reason': str(it.get('reason', ''))[:60],
    })
  return out


def _analyze_batch(anthropic_client, batch: list[dict]) -> list[dict]:
  user_prompt = _build_user_prompt(batch)
  resp = anthropic_client.messages.create(
    model=MODEL,
    max_tokens=MAX_TOKENS,
    system=SYSTEM_PROMPT,
    messages=[{'role': 'user', 'content': user_prompt}],
  )
  text = ''.join(b.text for b in resp.content if hasattr(b, 'text'))
  parsed = _parse_response(text)
  # post_id로 빠른 lookup
  by_id = {p['post_id']: p for p in parsed}
  rows = []
  now_iso = datetime.now(timezone.utc).isoformat()
  for p in batch:
    r = by_id.get(p['post_id'])
    if not r:
      continue
    rows.append({
      'company_id': p['company_id'],
      'post_id': p['post_id'],
      'label': r['label'],
      'score': r['score'],
      'reason': r['reason'] or None,
      'model': MODEL,
      'analyzed_at': now_iso,
    })
  return rows


def analyzeBoardSentiment(mode: str, limit: int, batch_size: int) -> None:
  pending = _load_pending(mode=mode, limit=limit)
  logger.info(f'감성 분석 대상: {len(pending)}건 (mode={mode}, batch={batch_size})')
  if not pending:
    return

  client = _get_client_anthropic()
  total_upserted = 0
  for i in range(0, len(pending), batch_size):
    batch = pending[i:i + batch_size]
    try:
      rows = _analyze_batch(client, batch)
    except Exception as e:
      logger.warning(f'batch {i // batch_size + 1} 분석 실패: {e}')
      time.sleep(1.0)
      continue
    if rows:
      upsert_rows('board_sentiment', rows, 'company_id,post_id')
      total_upserted += len(rows)
    logger.info(f'batch {i // batch_size + 1}: {len(batch)}건 요청 → {len(rows)}건 적재')
    time.sleep(0.3)  # rate limit 여유

  logger.info(f'감성 분석 완료 — 총 {total_upserted}건 upsert')


if __name__ == '__main__':
  parser = argparse.ArgumentParser(description='한세 종목토론 글 감성 분석 (Claude Haiku)')
  parser.add_argument('--mode', choices=['pending', 'all'], default='pending')
  parser.add_argument('--limit', type=int, default=DEFAULT_LIMIT)
  parser.add_argument('--batch', type=int, default=DEFAULT_BATCH)
  args = parser.parse_args()

  try:
    analyzeBoardSentiment(mode=args.mode, limit=args.limit, batch_size=args.batch)
  except Exception as e:
    import traceback
    logger.error(f'감성 분석 실패: {e}\n{traceback.format_exc()}')
    sys.exit(1)
