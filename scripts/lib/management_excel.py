"""월별손익 엑셀 경로 해석 — 환경변수 우선, 없으면 참고/손익 glob 최신.

GHA 업로드 경로: 오케스트레이터가 Storage에서 받은 파일을 MANAGEMENT_EXCEL_PATH로 지정.
로컬 수동 실행: 환경변수 없음 → 기존 '참고/손익/자료정리_월별손익*.xlsx' glob 동작 보존.
"""
import os
from pathlib import Path

GLOB = '자료정리_월별손익*.xlsx'


def resolve_excel_path(base_dir: Path | None = None) -> Path:
  env = os.environ.get('MANAGEMENT_EXCEL_PATH', '').strip()
  if env:
    p = Path(env)
    if not p.exists():
      raise FileNotFoundError(f'MANAGEMENT_EXCEL_PATH 파일 없음: {p}')
    return p
  base = base_dir or (Path(__file__).resolve().parents[2] / '참고' / '손익')
  cands = sorted(base.glob(GLOB))
  if not cands:
    raise FileNotFoundError(f'손익 엑셀 없음: {base}')
  return cands[-1]
