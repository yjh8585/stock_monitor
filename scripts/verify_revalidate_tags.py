"""캐시 태그 3곳 정합성 검사 (토큰 0, 기계로 판정 가능).

수집 스크립트가 DB 를 갱신해도 화면이 낡는 구멍은 두 방향으로 생긴다:
  1) TS 쪽 `cacheTag('X')` 가 있는데 `app/api/revalidate/route.ts` 의 `ALL_TAGS` 에
     없으면 — `tag=all` 로 무효화해도 그 페이지만 안 풀린다.
  2) `scripts/lib/revalidate.py` 의 `COLUMN_TO_TAGS` 가 존재하지 않는 태그를 가리키면 —
     수집기가 무효화를 호출해도 아무 페이지도 안 풀린다(오타·삭제된 태그 잔재).

세 곳:
  (1) TS 소스 전수의 cacheTag('X') (동적 cacheTag(company:${id}) 백틱 리터럴은 제외)
  (2) `app/api/revalidate/route.ts` 의 `ALL_TAGS`
  (3) `scripts/lib/revalidate.py` 의 `COLUMN_TO_TAGS` 값 합집합

판정: (1) ⊄ (2) 면 「tag=all 로 안 풀리는 태그」로 실패. (3) ⊄ (2) 면 「존재하지 않는 태그를
수집기가 부른다」로 실패. (2) − (1) 은 경고만(쓰던 태그를 지운 잔재일 수 있다).

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


def main() -> int:
  ts_tags = _scan_cache_tags()
  all_tags = _extract_all_tags()
  py_tag_values = _extract_column_to_tags_values()

  missing_in_all = sorted(ts_tags - all_tags)
  unknown_in_py = sorted(py_tag_values - all_tags)
  stale_in_all = sorted(all_tags - ts_tags)

  ok = True
  if missing_in_all:
    ok = False
    print(f'[실패] tag=all 로 안 풀리는 태그 {len(missing_in_all)}개 '
          f'(TS 에 cacheTag 는 있는데 ALL_TAGS 에 없음): {missing_in_all}')
  if unknown_in_py:
    ok = False
    print(f'[실패] 존재하지 않는 태그를 수집기가 부른다 {len(unknown_in_py)}개 '
          f'(COLUMN_TO_TAGS 값이 ALL_TAGS 에 없음): {unknown_in_py}')
  if stale_in_all:
    print(f'[경고] ALL_TAGS 에만 있고 TS cacheTag 는 없는 태그 {len(stale_in_all)}개 '
          f'(쓰던 태그를 지운 잔재일 수 있음): {stale_in_all}')

  if ok:
    print(f'[통과] cacheTag {len(ts_tags)}종 · ALL_TAGS {len(all_tags)}종 · '
          f'COLUMN_TO_TAGS 값 {len(py_tag_values)}종 — 정합성 이상 없음')
    return 0
  return 1


if __name__ == '__main__':
  sys.exit(main())
