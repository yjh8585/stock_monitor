#!/usr/bin/env python3
"""`PostList` 를 쓰는 화면이 «정렬 파라미터를 실제로 배선했는가» 검사 (exit 0 이 정상).

왜 필요한가 (2026-09-11 실측):
  `/humanoid/reports` 를 신설하면서 `PostList` 는 재사용했는데 **정렬 searchParams 를
  받는 부분을 빠뜨렸다.** `PostList` 는 정렬 링크를 정상적으로 만들지만 페이지가 그 값을
  읽지 않아 **URL 만 바뀌고 목록은 그대로**였다 — 「죽은 버튼」이다.

🔴 **이 결함은 lint·타입·테스트 어디에도 안 걸린다.** 타입상 `sort="source_published_at"`
   는 완벽히 유효한 리터럴이고, 컴포넌트는 「재사용했으니」 통과로 보인다. AGENTS.md 가
   경고한 「반만 쓰는 변형」의 전형이라 사람 눈 대신 이 검사기가 지킨다.

무엇을 보나 — `PostList` 를 렌더하는 `app/**/page.tsx` 마다:
  1. `searchParams` 타입에 `sort` 와 `order` 가 있는가
  2. `normalizeSort` · `normalizeOrder`(정본 `lib/reports/sort.ts`)를 쓰는가
  3. `<PostList ... sort=` 에 **문자열 리터럴을 박지 않았는가**

사용:
  scripts/venv/Scripts/python.exe scripts/verify_report_sort_wiring.py
"""
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'app'

# <PostList ... sort="문자열" /> — 하드코딩된 정렬. 변수 바인딩(`sort={sort}`)은 정상이다.
HARDCODED_SORT = re.compile(r'<PostList\b[^>]*?\bsort=\s*"([^"]+)"', re.S)
HARDCODED_ORDER = re.compile(r'<PostList\b[^>]*?\border=\s*"([^"]+)"', re.S)


def _search_params_block(text: str) -> str:
  """`searchParams: Promise<{...}>` 안쪽. 못 찾으면 빈 문자열."""
  m = re.search(r'searchParams:\s*Promise<\{(.*?)\}>', text, re.S)
  return m.group(1) if m else ''


def main() -> int:
  failures: list[str] = []
  checked = 0

  for path in sorted(APP.rglob('page.tsx')):
    text = path.read_text(encoding='utf-8')
    if '<PostList' not in text:
      continue
    checked += 1
    rel = path.relative_to(ROOT).as_posix()
    params = _search_params_block(text)

    if 'sort?' not in params or 'order?' not in params:
      failures.append(
        f'{rel}: searchParams 에 sort·order 가 없다 — 정렬 링크를 눌러도 아무 일도 안 일어난다'
      )
    if 'normalizeSort' not in text or 'normalizeOrder' not in text:
      failures.append(
        f'{rel}: normalizeSort/normalizeOrder 미사용 — 정본은 lib/reports/sort.ts 다'
      )
    for label, rx in (('sort', HARDCODED_SORT), ('order', HARDCODED_ORDER)):
      m = rx.search(text)
      if m:
        failures.append(
          f'{rel}: <PostList {label}="{m.group(1)}"> 처럼 값을 박았다 — '
          f'searchParams 에서 받은 변수를 넘길 것'
        )

  if checked == 0:
    print('[FAIL] PostList 를 쓰는 page.tsx 를 하나도 못 찾았다 — 검사 대상이 사라졌거나 경로가 바뀌었다')
    return 1

  for f in failures:
    print(f'[FAIL] {f}')
  print(f'\n검사 화면 {checked}개 — 실패 {len(failures)}건')
  return 1 if failures else 0


if __name__ == '__main__':
  sys.exit(main())
