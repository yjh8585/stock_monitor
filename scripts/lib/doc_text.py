"""공시·보도자료 원문 → 파서가 읽는 텍스트·표 행.

고객사 수집기(collect_customer_*)와 스텔란티스 출하 수집기가 같이 쓴다.
`normalize_cell`·`html_to_table_rows` 는 collect_stellantis_shipments.py 에서 그대로 옮겼다
(그쪽은 같은 이름으로 다시 내보내 기존 호출부·시험이 그대로 돈다).
"""
import html as _html
import re

from bs4 import BeautifulSoup

# 각종 대시(‐ ‑ ‒ – — ― −) → '-' · 굽은 따옴표 → 곧은 따옴표. 회차마다 섞여 나와(리비안 `-`·`–`) 파서 정규식을 하나로 쓰려고 맞춘다.
_DASHES = dict.fromkeys(map(ord, '‐‑‒–—―−'), '-')
_QUOTES = {0x201C: '"', 0x201D: '"', 0x2018: "'", 0x2019: "'"}


def normalize_cell(text: str | None) -> str:
  """표 셀 텍스트 정규화 — nbsp 제거 + 트림."""
  if text is None:
    return ''
  return text.replace('\xa0', ' ').strip()


def norm_text(s: str) -> str:
  """nbsp·대시·굽은 따옴표를 하나로 맞추고 공백을 한 칸으로."""
  s = s.replace('\xa0', ' ').translate(_DASHES).translate(_QUOTES)
  return re.sub(r'\s+', ' ', s).strip()


def html_to_text(html: str) -> str:
  """HTML 본문 → 한 줄 텍스트(script·style 제외)."""
  soup = BeautifulSoup(html, 'html.parser')
  for tag in soup(['script', 'style']):
    tag.decompose()
  return norm_text(soup.get_text(' '))


def html_to_table_rows(html: str) -> list[list[list[str]]]:
  """HTML → 표별 정규화 행 매트릭스 (빈 셀 제거)."""
  soup = BeautifulSoup(html, 'html.parser')
  tables: list[list[list[str]]] = []
  for table in soup.find_all('table'):
    rows: list[list[str]] = []
    for tr in table.find_all('tr'):
      cells = [normalize_cell(c.get_text(' ')) for c in tr.find_all(['td', 'th'])]
      cells = [c for c in cells if c != '']
      if cells:
        rows.append(cells)
    if rows:
      tables.append(rows)
  return tables


def xml_to_text(xml: str) -> str:
  """DART document.xml → 태그를 지우고 공백을 한 칸으로(실측 파일 korea.md 의 표본과 같은 꼴)."""
  return norm_text(_html.unescape(re.sub(r'<[^>]+>', ' ', xml)))


def pdf_text(pdf_bytes: bytes) -> str:
  """PDF → 쪽을 줄바꿈으로 이은 텍스트.

  summarize_naver_research.pdf_text 와 같은 pymupdf 호출이지만 그쪽은 실패를 빈 문자열로 삼킨다.
  여기서는 예외를 그대로 올린다 — 빈 문자열이 「숫자 0개」로 이어져 형식 변경과 구분이 안 된다.
  """
  import fitz  # pymupdf — requirements.txt 에 이미 있다

  with fitz.open(stream=pdf_bytes, filetype='pdf') as doc:
    return '\n'.join(page.get_text() for page in doc)


def row_text(row: list[str]) -> str:
  """표 행 → 인용 칸에 넣을 한 줄(셀 사이 ' | ')."""
  return ' | '.join(norm_text(c) for c in row)
