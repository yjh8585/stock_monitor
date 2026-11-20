"""최신 Claude 모델 ID 를 Models API 로 고른다.

사용자 지시(2026-11-20): 「GHA 에서 쓰는 하이쿠를 최신 버전으로 알아서 쓰게」.
모델 ID 를 코드에 박으면 새 하이쿠가 나와도 옛 모델에 머문다. 그래서 실행 때
`GET /v1/models` 목록에서 `claude-haiku-` 로 시작하는 것 중 가장 최근(`created_at`)을 쓴다.

- 목록 조회가 실패하면(키 없음·네트워크) `FALLBACK` 으로 돌아가고 경고만 남긴다 —
  모델 선택 때문에 수집이 죽지는 않게 한다.
- 프로세스 안에서 한 번만 조회한다(가족별 캐시).
- 🔴 폴백을 `claude-haiku-4-5` 로 내리지 말 것 — 호출부가 4.5 에서 400 이 나는 인자
  (`effort` 등)를 쓰게 되면 폴백이 오히려 죽는다. 폴백은 «지금 알려진 최신» 으로 둔다.
- 조회는 10초·재시도 1회로 묶는다 — SDK 기본(10분 × 3회)이면 API 가 멈췄을 때 수집 시작 전에
  최대 30분을 기다린다(GHA 작업 한도 20분).
- TS 짝 = `lib/reports/anthropic.ts` 의 `latestHaikuModel()`(같은 규칙 · 같은 폴백 — 바꿀 땐 함께).
"""
from __future__ import annotations

from loguru import logger

FALLBACK = {'haiku': 'claude-haiku-5-5'}

_cache: dict[str, str] = {}


def latest_model(family: str) -> str:
  """`claude-<family>-*` 중 가장 최근 모델 ID. 조회 실패 시 FALLBACK[family]."""
  if family in _cache:
    return _cache[family]
  fallback = FALLBACK[family]
  prefix = f'claude-{family}-'
  try:
    import anthropic  # 모델을 실제로 고를 때만 SDK 를 부른다

    client = anthropic.Anthropic(timeout=10, max_retries=1)
    models = [m for m in client.models.list(limit=1000) if m.id.startswith(prefix)]
  except Exception as e:  # noqa: BLE001 — 외부 API 경계: 모델 고르기 실패가 수집을 죽이면 안 된다
    logger.warning(f'모델 목록 조회 실패 — {fallback} 사용: {e}')
    return fallback
  if not models:
    logger.warning(f'모델 목록에 {prefix}* 없음 — {fallback} 사용')
    return fallback
  chosen = max(models, key=lambda m: m.created_at).id
  _cache[family] = chosen
  logger.info(f'최신 {family} 모델: {chosen}')
  return chosen


def latest_haiku() -> str:
  return latest_model('haiku')
