"""고객사 문서 요약용 PDF 쪽 도구 — 쪽 표식 글 · 지정 쪽 렌더 · 비공개 버킷 업로드.

호출 = scripts/summarize_customer_docs.py. 화면은 인증 프록시 라우트로만 내준다(버킷 public=false · 정책 없음).
- page_marked_text: 모델이 근거 쪽을 고르도록 쪽마다 [p.N] 표식을 단 글(lib/doc_text.pdf_text 는 표식이 없다).
  🔴 검사기(customer_summary_check)는 숫자 대조 전에 이 표식을 지운다 — 표식 수가 숫자 근거로 통과하지 않게.
- render_page: pdf_figures.render_pages 는 앞에서부터 N쪽이라 지정 쪽 하나를 따로 렌더한다(같은 배율).
- upload_png: sync_org_chart.upload_png 꼴(버킷만 다름 · 바이트를 받는다). 실패는 raise — 호출자가 그 쪽만 뺀다.
"""
import os

import requests

from lib.pdf_figures import RENDER_ZOOM

BUCKET = 'customer-doc-pages'


def _open(pdf):
  """바이트면 메모리에서 · 경로(str)면 파일에서 연다 — 50MB 를 넘는 PDF 는 요약기가 디스크로 받아 경로를 넘긴다."""
  import fitz  # pymupdf

  return fitz.open(pdf) if isinstance(pdf, str) else fitz.open(stream=pdf, filetype='pdf')


def page_marked_text(pdf: bytes | str) -> tuple[str, int]:
  """PDF(바이트 또는 파일 경로) → ('[p.1]\\n…\\n[p.2]\\n…', 쪽 수). 예외는 그대로 올린다(빈 글이 「요약할 것 없음」으로 뭉개지지 않게)."""
  with _open(pdf) as doc:
    parts = [f'[p.{i}]\n{page.get_text()}' for i, page in enumerate(doc, start=1)]
    return '\n'.join(parts), len(parts)


def render_page(pdf: bytes | str, page_no: int) -> bytes | None:
  """1부터 센 쪽 하나를 PNG 로(바이트 또는 파일 경로). 범위 밖·렌더 실패는 None(호출자가 그 쪽만 빼고 로그)."""
  import fitz  # pymupdf

  try:
    with _open(pdf) as doc:
      if not 1 <= page_no <= doc.page_count:
        return None
      return doc[page_no - 1].get_pixmap(matrix=fitz.Matrix(RENDER_ZOOM, RENDER_ZOOM)).tobytes('png')
  except Exception:
    return None


def page_key(company_id: str, doc_id: int, page_no: int) -> str:
  return f'{company_id}/{doc_id}/p{page_no}.png'


def upload_png(key: str, png: bytes) -> None:
  url = os.environ['SUPABASE_URL'].rstrip('/') + f'/storage/v1/object/{BUCKET}/{key}'
  service_key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
  resp = requests.post(url, data=png, timeout=60, headers={
    'apikey': service_key,
    'Authorization': f'Bearer {service_key}',
    'Content-Type': 'image/png',
    'x-upsert': 'true',
  })
  if resp.status_code not in (200, 201):
    raise RuntimeError(f'Storage 업로드 실패 {resp.status_code}')
