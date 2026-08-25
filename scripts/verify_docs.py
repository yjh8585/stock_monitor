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
  'docs/gotchas-data-collection.md', 'docs/gotchas-ci-deploy.md',
  'docs/isr-write-optimization.md',
]

# AGENTS.md는 매 세션 자동 로드되므로 분량 상한을 둔다.
AUTOLOAD_DOC = 'AGENTS.md'
# 🔴 상한은 "직전 다이어트 결과 + 약 5%"로 조인다. 넉넉히 잡으면 검사가 무력해진다.
#    2026-08-12 실측: 상한이 70,000이라 55,936B에도 계속 OK가 떴고, 08-04에 65.4KB로 줄인 뒤
#    68.8KB까지 자라는 동안 내내 통과였다 — 두 번 다이어트하고 두 번 되돌아온 구조적 원인이다.
#    (같은 사용자의 agents 레포도 같은 이유로 16KB→71KB로 복원됐다.)
#    ⚠ 늘리고 싶으면 상한을 올리지 말고 서술을 docs/gotchas-*.md·Architecture.md로 옮길 것.
#    2026-08-12 이관 후 재측정: 56,276 → 37,134B 가 **품질을 해치지 않는 바닥**이었다.
#    남은 것은 전부 약속·금지사항·실행 명령이고 더 깎으려면 규칙 자체를 지워야 한다
#    (`.range()` 정렬 필수 · `WriteSession` 강제 · 사외비 5-step · 역할 추가 3파일 등).
#    그래서 상한을 실측 바닥 + 5% 로 다시 잡는다. 35,000 은 이관 **전에** 세운 희망치였다.
#    🔴 이 값을 다시 올리려거든 먼저 "옮길 곳이 정말 없나"를 증명할 것.
#    2026-08-25 재정리: 「디렉터리 지도」 20,029B(파일의 45%)를 Architecture.md 부록 C로 이관하고
#    그 안의 약속 26건만 원문 발췌해 남겼다 → 44,384 → 34,966B.
#    🔴 상한은 그 실측값 + 여유 2,500 으로 **조인다**. 여유가 크면 브레이크가 아니라 눈금자다.
#    🔴 그리고 초과는 경고가 아니라 **오류**다(exit 1) — 경고로 두었더니 2주째 초과인 줄 몰랐다.
AUTOLOAD_WARN_BYTES = 37_500   # 넘으면 참조형을 Architecture.md·docs/ 로 옮길 시점
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
      # 🔴 2026-08-25: 여기가 warnings 였다 — 초과를 경고로만 세니 종료 코드가 0 이라
      #    **2주째 상한을 넘고 있는 줄 아무도 몰랐다**(44,384B / 상한 39,000B).
      #    검사기는 「무엇을 재나」만이 아니라 「걸리면 무슨 일이 일어나나」까지 같아야 한다.
      errors.append(
        f'{AUTOLOAD_DOC}가 {size:,}B로 상한 {AUTOLOAD_WARN_BYTES:,}B 초과 — '
        f'참조형(구조 설명·명령 목록·env)은 Architecture.md·docs/로 옮기고 트리거 한 줄만 남길 것. '
        f'🔴 상한을 올려서 통과시키지 말 것')

  for w in warnings:
    print(f'[WARN] {w}')
  for e in errors:
    print(f'[FAIL] {e}')
  print(f'\n검사 문서 {len(DOCS)}개 — 오류 {len(errors)}건, 경고 {len(warnings)}건')
  return len(errors)


if __name__ == '__main__':
  sys.exit(1 if verifyDocs() else 0)
