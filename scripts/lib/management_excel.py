"""월별손익 엑셀 경로 해석 — 환경변수 우선, 없으면 참고/손익 glob 최신.

GHA 업로드 경로: 오케스트레이터가 Storage에서 받은 파일을 MANAGEMENT_EXCEL_PATH로 지정.
로컬 수동 실행: 환경변수 없음 → '참고/손익/자료정리_월별손익*.xlsx' 중 파일명 날짜가 가장 늦은 것.
"""
import os
import re
from pathlib import Path

GLOB = '자료정리_월별손익*.xlsx'
# 파일명 속 날짜 「2026 10 31」 — 연·월·일을 숫자로 읽는다.
_DATE_RE = re.compile(r'(\d{4})\D+(\d{1,2})\D+(\d{1,2})')


def _date_key(p: Path) -> tuple[int, int, int]:
  """파일명 속 날짜. 🔴 글자순 정렬은 「2026 6 22」를 「2026 10 31」보다 뒤로 본다(2026-11-23 실측 —
  로컬 실행이 6월 파일을 읽었다). 날짜를 못 읽은 파일은 (0,0,0) 이라 날짜가 있는 파일에 늘 진다."""
  m = _DATE_RE.search(p.stem)
  return (int(m[1]), int(m[2]), int(m[3])) if m else (0, 0, 0)


def resolve_excel_path(base_dir: Path | None = None) -> Path:
  env = os.environ.get('MANAGEMENT_EXCEL_PATH', '').strip()
  if env:
    p = Path(env)
    if not p.exists():
      raise FileNotFoundError(f'MANAGEMENT_EXCEL_PATH 파일 없음: {p}')
    return p
  base = base_dir or (Path(__file__).resolve().parents[2] / '참고' / '손익')
  # 같은 날짜면 이름순 — 「… 5 27 - 복사본」보다 「… 5 27」이 뒤라 원본이 뽑힌다.
  cands = sorted(base.glob(GLOB), key=lambda p: (_date_key(p), p.name))
  if not cands:
    raise FileNotFoundError(f'손익 엑셀 없음: {base}')
  return cands[-1]
