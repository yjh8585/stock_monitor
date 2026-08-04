#!/usr/bin/env python3
"""마크다운 문서 무결성 검사 — 표 구조·상대 링크·자동 로드 분량.

배경(2026-08-04): AGENTS.md가 91.5KB까지 불어나 매 세션 자동 로드 비용이 커졌다.
원인 둘 중 하나는 **표 정렬 공백이 파일의 21%** 였다 — prettier가 가장 긴 셀에 맞춰
모든 행을 패딩해서, `| /compare | 다중 회사 비교 |` 한 줄이 1,792바이트가 됐다.
같은 일이 반복되지 않게 기계로 감시한다(토큰 0).

검사 항목:
  1. 표 구조 — 행별 셀 개수가 헤더와 일치하는가(이스케이프된 `\\|`는 셀 경계 아님)
  2. 상대 링크 — `](./x.md)` 가 실재하는 파일을 가리키는가
     (문서를 docs/ 로 옮길 때 링크가 조용히 깨지는 사고를 잡는다)
  3. 자동 로드 분량 — AGENTS.md 가 임계값을 넘지 않는가
  4. 표 패딩 — 정렬 공백이 파일에서 차지하는 비중

실행:
  scripts/venv/Scripts/python.exe scripts/verify_docs.py
"""
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 검사 대상 — 사람이 읽고 에이전트가 참조하는 문서
DOCS = [
  'AGENTS.md', 'CLAUDE.md', 'Architecture.md', 'ROADMAP.md', 'report.md',
  'docs/chart-guide.md', 'docs/oem-collection.md', 'docs/data-audit-2026-07-18.md',
  'docs/fnguide-wcomp-migration.md', 'docs/gotchas-playwright-ui.md',
  'docs/gotchas-data-collection.md', 'docs/isr-write-optimization.md',
]

# AGENTS.md는 매 세션 자동 로드되므로 분량 상한을 둔다.
AUTOLOAD_DOC = 'AGENTS.md'
AUTOLOAD_WARN_BYTES = 70_000   # 넘으면 gotchas 분리를 검토할 시점
PADDING_WARN_RATIO = 0.10      # 표 정렬 공백이 파일의 10% 넘으면 경고

# 이스케이프되지 않은 파이프만 셀 경계로 본다.
_CELL_SPLIT = re.compile(r'(?<!\\)\|')
_LINK = re.compile(r'\]\((\.\.?/[^)#]+)')


def split_cells(line: str) -> list[str]:
  """표 한 줄을 셀 목록으로 분리한다(`\\|` 는 경계 아님)."""
  body = _CELL_SPLIT.sub('\x00', line.strip()).strip('\x00')
  return body.split('\x00')


def table_blocks(lines: list[str]) -> list[list[tuple[int, str]]]:
  """연속된 표 줄을 블록 단위로 묶는다."""
  blocks: list[list[tuple[int, str]]] = []
  cur: list[tuple[int, str]] = []
  for i, line in enumerate(lines):
    if line.lstrip().startswith('|'):
      cur.append((i, line))
    elif cur:
      blocks.append(cur)
      cur = []
  if cur:
    blocks.append(cur)
  return blocks


def check_tables(path: Path, lines: list[str]) -> list[str]:
  """행별 셀 개수가 헤더와 다른 줄을 찾는다."""
  errs = []
  for blk in table_blocks(lines):
    base = len(split_cells(blk[0][1]))
    for i, line in blk:
      n = len(split_cells(line))
      if n != base:
        errs.append(f'{path.name}:{i + 1} 표 셀 {n}개 (헤더 {base}개) — '
                    f'셀 안 `|` 는 `\\|` 로 이스케이프할 것')
  return errs


def check_links(path: Path, text: str) -> list[str]:
  """상대 링크가 실재하는지 확인한다."""
  errs = []
  for link in sorted(set(_LINK.findall(text))):
    target = (path.parent / link).resolve()
    if not target.exists():
      errs.append(f'{path.name}: 깨진 링크 {link}')
  return errs


def padding_ratio(lines: list[str]) -> tuple[int, int]:
  """(표 정렬 공백 바이트, 파일 바이트)."""
  total = len('\n'.join(lines).encode('utf-8'))
  tbl = [ln for ln in lines if ln.lstrip().startswith('|')]
  raw = sum(len(ln.encode('utf-8')) for ln in tbl)
  squeezed = sum(len(re.sub(r' {2,}', ' ', ln).encode('utf-8')) for ln in tbl)
  return raw - squeezed, total


def verifyDocs() -> int:
  """문서 무결성을 검사하고 실패 수를 반환한다."""
  errors: list[str] = []
  warnings: list[str] = []

  for name in DOCS:
    path = ROOT / name
    if not path.exists():
      warnings.append(f'{name}: 파일 없음 (DOCS 목록 갱신 필요)')
      continue
    text = path.read_text(encoding='utf-8')
    lines = text.split('\n')

    errors += check_tables(path, lines)
    errors += check_links(path, text)

    # 패딩은 **자동 로드 문서에만** 따진다. 참조 문서는 필요할 때만 읽으므로
    # 정렬된 표의 가독성이 더 가치 있고, 여기까지 경고를 켜면 정상 상태에서
    # 상시 경고가 떠서 진짜 신호가 묻힌다.
    if name == AUTOLOAD_DOC:
      pad, total = padding_ratio(lines)
      if total and pad / total > PADDING_WARN_RATIO:
        warnings.append(
          f'{name}: 표 정렬 공백이 {pad:,}B ({pad / total:.0%}) — '
          f'긴 셀을 표 밖 `#### 상세` 블록으로 뺄 것')

  autoload = ROOT / AUTOLOAD_DOC
  if autoload.exists():
    size = len(autoload.read_bytes())
    status = 'OK' if size <= AUTOLOAD_WARN_BYTES else '초과'
    print(f'{AUTOLOAD_DOC} 자동 로드 분량: {size:,}B / 상한 {AUTOLOAD_WARN_BYTES:,}B — {status}')
    if size > AUTOLOAD_WARN_BYTES:
      warnings.append(
        f'{AUTOLOAD_DOC}가 {size:,}B — 함정 서술을 `docs/gotchas-*.md`로 분리할 시점')

  for w in warnings:
    print(f'[WARN] {w}')
  for e in errors:
    print(f'[FAIL] {e}')
  print(f'\n검사 문서 {len(DOCS)}개 — 오류 {len(errors)}건, 경고 {len(warnings)}건')
  return len(errors)


if __name__ == '__main__':
  sys.exit(1 if verifyDocs() else 0)
