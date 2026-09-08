"""캐시 태그 3곳 정합성 검사 (토큰 0, 기계로 판정 가능).

수집 스크립트가 DB 를 갱신해도 화면이 낡는 구멍은 **세 방향**으로 생긴다:

  1) TS 쪽 `cacheTag('X')` 가 있는데 `app/api/revalidate/route.ts` 의 `ALL_TAGS` 에
     없으면 — `tag=all` 로 무효화해도 그 페이지만 안 풀린다.
  2) `scripts/lib/revalidate.py` 의 `COLUMN_TO_TAGS` 가 존재하지 않는 태그를 가리키면 —
     수집기가 무효화를 호출해도 아무 페이지도 안 풀린다(오타·삭제된 태그 잔재).
  3) 🔴 **역방향** — 태그는 있는데 그것을 부르는 **원천 테이블 매핑이 없으면**, 수집이
     성공해도 그 페이지는 영원히 낡는다. 아무 데서도 에러가 안 나므로 화면을 눈으로
     보기 전엔 모른다. `hyundai_retail_sales` 가 정확히 이 유형이었다(2026-09-08 실측:
     태그 `oem-hyundai-retail` 은 TS 에 있는데 `COLUMN_TO_TAGS` 에 키 자체가 없었다).
     ①②만 보던 초판은 이 구멍을 통과시켰다 — 그래서 ③을 뒤늦게 붙였다.

세 곳:
  (1) TS 소스 전수의 cacheTag('X') (동적 cacheTag(`company:${id}`) 백틱 리터럴은 제외)
  (2) `app/api/revalidate/route.ts` 의 `ALL_TAGS`
  (3) `scripts/lib/revalidate.py` 의 `COLUMN_TO_TAGS` 값 합집합

판정 로직은 순수 함수 `evaluate()` 에 있고 `scripts/lib/test_verify_revalidate_tags.py`
가 검사기 **자신**을 시험한다(위반을 심어 실제로 잡히는지 · 예외가 과잉 면제하지 않는지).

⚠️ 한계: 정규식은 실제 호출과 주석·문자열 안의 텍스트를 구분하지 않는다. 주석 속에
cacheTag('X') 형태를 그대로 적어 두면(설명용 예시 등) 실제 호출이 없어도 (1)의 태그
집합에 잡힌다 — 현재 코드베이스에는 이런 사례가 없어 오탐이 관측되지 않았을 뿐이다.

사용: scripts/venv/Scripts/python.exe scripts/verify_revalidate_tags.py
"""
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parent.parent
ROUTE_TS = ROOT / 'app' / 'api' / 'revalidate' / 'route.ts'
REVALIDATE_PY = ROOT / 'scripts' / 'lib' / 'revalidate.py'

# 작은따옴표 리터럴만 잡는다 — 백틱 동적 태그(`company:${id}`)는 건너뛴다.
CACHE_TAG_RE = re.compile(r"cacheTag\(\s*'([a-zA-Z0-9_\-]+)'\s*\)")
ALL_TAGS_RE = re.compile(r"'([a-zA-Z0-9_\-]+)'")
DICT_VALUE_RE = re.compile(r"'([a-zA-Z0-9_\-]+)'")

# 검사 대상 TS 소스 루트 (node_modules·빌드 산출물 제외)
TS_SCAN_DIRS = ['app', 'lib', 'components']
TS_EXTS = {'.ts', '.tsx'}

# ③ 역방향 검사의 **의도된 예외** — 수집기가 쓰지 않는 테이블의 태그.
#
# 🔴 여기에 태그를 더하는 것은 「이 데이터는 수집기가 안 건드린다」는 **주장**이다.
#    수집 경로가 생기면 예외가 아니라 `COLUMN_TO_TAGS` 매핑이 필요하다. 그래서
#    예외가 실제로는 매핑을 갖게 되면 아래 검사가 「낡은 예외」로 경고한다.
TAGS_WITHOUT_COLLECTOR = frozenset({
  # 모델→Cox 브랜드 매핑 SSOT. 마이그레이션으로만 바뀌고(AGENTS.md 「바꾸려면 새
  # 마이그레이션」) 수집기가 쓰지 않으므로 COLUMN_TO_TAGS 매핑 대상이 아니다.
  'oem_model_brand',
})


def _scan_cache_tags() -> set[str]:
  """app/lib/components 전체에서 cacheTag('X') 리터럴 전수를 모은다."""
  tags: set[str] = set()
  for dirname in TS_SCAN_DIRS:
    base = ROOT / dirname
    if not base.exists():
      continue
    for path in base.rglob('*'):
      if path.suffix not in TS_EXTS or not path.is_file():
        continue
      text = path.read_text(encoding='utf-8', errors='replace')
      tags.update(CACHE_TAG_RE.findall(text))
  return tags


def _extract_all_tags() -> set[str]:
  """route.ts 의 ALL_TAGS 배열 리터럴만 추출한다(POST 핸들러 등 나머지 코드는 건너뛴다)."""
  text = ROUTE_TS.read_text(encoding='utf-8', errors='replace')
  m = re.search(r'const ALL_TAGS[^=]*=\s*\[(.*?)\];', text, re.DOTALL)
  if not m:
    raise RuntimeError('ALL_TAGS 배열을 route.ts 에서 찾지 못했다 — 정규식/구조 확인 필요')
  return set(ALL_TAGS_RE.findall(m.group(1)))


def _extract_column_to_tags_values() -> set[str]:
  """revalidate.py 의 COLUMN_TO_TAGS 딕셔너리 값(리스트 원소) 전수를 모은다."""
  text = REVALIDATE_PY.read_text(encoding='utf-8', errors='replace')
  m = re.search(r'COLUMN_TO_TAGS\s*=\s*\{(.*?)\n\}', text, re.DOTALL)
  if not m:
    raise RuntimeError('COLUMN_TO_TAGS 딕셔너리를 revalidate.py 에서 찾지 못했다')
  body = m.group(1)
  tags: set[str] = set()
  # 'key': [...] 형태에서 리스트 부분만 값으로 취급 — 키 자체(테이블명)는 값 집합에서 뺀다.
  for key_match in re.finditer(r"'[a-zA-Z0-9_\-]+'\s*:\s*\[([^\]]*)\]", body):
    tags.update(DICT_VALUE_RE.findall(key_match.group(1)))
  return tags


def evaluate(
  ts_tags: set[str],
  all_tags: set[str],
  py_values: set[str],
  exempt: frozenset[str] = TAGS_WITHOUT_COLLECTOR,
) -> dict[str, list[str]]:
  """세 집합을 받아 위반 목록을 낸다 (순수 함수 — 파일을 읽지 않는다).

  실패: missing_in_all · unknown_in_py · no_collector
  경고: stale_exempt · stale_in_all
  """
  return {
    # ① tag=all 로 무효화해도 안 풀린다
    'missing_in_all': sorted(ts_tags - all_tags),
    # ② 수집기가 존재하지 않는 태그를 부른다
    'unknown_in_py': sorted(py_values - all_tags),
    # ③ 역방향 — 태그는 있는데 그것을 부르는 원천 테이블 매핑이 없다
    'no_collector': sorted(ts_tags - py_values - exempt),
    # 예외로 적어 뒀는데 실제로는 매핑이 생긴 것 = 예외가 낡았다
    'stale_exempt': sorted(exempt & py_values),
    # 쓰던 태그를 지운 잔재일 수 있다
    'stale_in_all': sorted(all_tags - ts_tags),
  }


FAIL_KEYS = ('missing_in_all', 'unknown_in_py', 'no_collector')

MESSAGES = {
  'missing_in_all': 'tag=all 로 안 풀리는 태그 (TS 에 cacheTag 는 있는데 ALL_TAGS 에 없음)',
  'unknown_in_py': '존재하지 않는 태그를 수집기가 부른다 (COLUMN_TO_TAGS 값이 ALL_TAGS 에 없음)',
  'no_collector': '수집해도 안 풀리는 태그 (이 태그를 부르는 원천 테이블 매핑이 COLUMN_TO_TAGS 에 없음)',
  'stale_exempt': '낡은 예외 (TAGS_WITHOUT_COLLECTOR 에 있는데 매핑이 생겼다 — 예외를 지울 것)',
  'stale_in_all': 'ALL_TAGS 에만 있고 TS cacheTag 는 없는 태그 (쓰던 태그를 지운 잔재일 수 있음)',
}


def main() -> int:
  ts_tags = _scan_cache_tags()
  all_tags = _extract_all_tags()
  py_values = _extract_column_to_tags_values()
  found = evaluate(ts_tags, all_tags, py_values)

  ok = True
  for key in FAIL_KEYS:
    if found[key]:
      ok = False
      print(f'[실패] {MESSAGES[key]} {len(found[key])}개: {found[key]}')
  for key in ('stale_exempt', 'stale_in_all'):
    if found[key]:
      print(f'[경고] {MESSAGES[key]} {len(found[key])}개: {found[key]}')

  if ok:
    print(f'[통과] cacheTag {len(ts_tags)}종 · ALL_TAGS {len(all_tags)}종 · '
          f'COLUMN_TO_TAGS 값 {len(py_values)}종 · 매핑 면제 {len(TAGS_WITHOUT_COLLECTOR)}종 '
          f'— 정합성 이상 없음')
    return 0
  return 1


if __name__ == '__main__':
  sys.exit(main())
