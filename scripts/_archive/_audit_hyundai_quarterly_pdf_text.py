#!/usr/bin/env python3
"""다운로드한 분기 IR PDF의 텍스트 일부 추출 — 어떤 데이터가 있는지 확인."""
import sys
from pathlib import Path

PDF = (
  Path(__file__).resolve().parent.parent
  / 'data' / '_hyundai_quarterly_downloads'
  / '__audit_q1-2025-earnings-call-pt-final-ko.pdf'
)


def main() -> int:
  try:
    from pypdf import PdfReader
  except ImportError:
    try:
      from PyPDF2 import PdfReader  # type: ignore
    except ImportError:
      print('pypdf/PyPDF2 모두 미설치')
      return 1

  r = PdfReader(str(PDF))
  print(f"pages={len(r.pages)}")
  for i, page in enumerate(r.pages):
    if i < 7 or i > 13:
      continue
    txt = page.extract_text() or ''
    txt = '\n'.join(line.strip() for line in txt.splitlines() if line.strip())
    print(f"\n--- page {i+1} ---")
    print(txt[:2000])
  return 0


if __name__ == '__main__':
  sys.exit(main())
