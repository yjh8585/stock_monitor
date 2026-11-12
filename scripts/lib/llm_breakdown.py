"""정기(API) 지역·차종·점유율 읽기 — 코드 파서(customer_parsers/breakdown.py)가 맡지 않는 문서의 C 재료 쪽(C-4).

계획 = docs/plans/2026-11-11-customers-page-revisions.md 「Task C-4」. 호출 꼴 = summarize_customer_docs._call(구조화 출력
json_schema · 반환 (결과, 본문, 토큰) · max_tokens·refusal 은 Incomplete). 모델·강도·단가도 그 파일 상수를 그대로 쓴다.

- 입력 = 요약기가 남긴 c_materials 의 쪽(PDF 면 그 쪽 PNG + 글자층 · 많아야 MAX_PAGES 쪽) · 비PDF 면 본문 전체.
- 응답 행은 extractor='llm' 으로 lib/customer_breakdown.verify 를 지난다 — 글자층에 없는 그림 속 숫자는 두 번째 읽기가 없어
  'image_only:' 로 남고 화면에 안 뜬다(결정 C8).
  SHORTCUT: 그림 속 숫자는 정기 경로에서 버려진다 → 필요해지면 다른 호출로 독립 두 번째 읽기를 붙여 double_read 로 올린다.
- 🔴 검사기가 거르는 규칙(수준 값만 · 인용은 그 쪽 글자 그대로 · 기간 꼴 · 단위 목록)은 SYSTEM 에도 같은 말로 적는다.
  지시문을 바꾸면 PROMPT_VERSION 을 올린다.
"""
import base64

PROMPT_VERSION = 'c2-2026-11-12'
MAX_PAGES = 6
MAX_CHARS = 120_000   # 비PDF 본문 상한(가장 긴 EDGAR 보도자료 ≈ 5만 자)

SYSTEM = """너는 자동차 회사 IR 문서에서 지역별·차종(브랜드·부문)별·시장 점유율 «수준» 값만 뽑는다.

규칙:
1. 수준 값만 — 대수(units), 구성비(pct: 회사 안에서 차지하는 비중 %), 시장 점유율(share_pct: 시장 대비 %), 매출(KRW·USD·EUR·VND).
   「+11%」「−20% y/y」처럼 증감률만 있고 수준 값이 없는 항목은 내지 않는다.
2. value 는 단위를 푼 전체 값이다 — 「357 (000s)」 → 357000, 「$1,815 million」 → 1815000000, 「7.5%」 → 7.5.
3. quote 는 그 쪽 글자층(아래 「p.N 글자층」)에 있는 글을 한 글자도 바꾸지 않고 연속 구간으로 옮긴다. 값이 그 안에 있어야 한다.
   값이 그림 속에만 있고 글자층에 없으면 그 쪽 글자층에서 그 항목 이름이 든 구간을 quote 로 적는다(검증에서 따로 처리된다).
4. page 는 PDF 쪽 번호(1부터), 쪽이 없는 문서는 null.
5. period_grain·period 꼴: month=YYYY-MM · quarter=YYYY-Qn · half=YYYY-H1/H2 · ytd=YYYY-NM(1~N월 누계, 예 2026-9M) ·
   year=YYYY · asof=YYYY-MM-DD(시점 값).
6. kind: region(지역·시장) · model(차종·브랜드·사업 부문) · share(시장 점유율). label_raw 는 문서의 구분 이름 그대로,
   label_ko 는 한국어 이름. metric 은 원문 성격(deliveries·sales·wholesale·shipments·retail·revenue·orders·market_share 등).
7. definition 은 그 값의 뜻을 한국어 한 줄로(문서에 정의가 있으면 그 뜻) — 모르면 null.
8. 문서가 전년 같은 기간 값을 같은 표에 실으면 그 값도 낸다(기간이 다른 행). 없는 값을 짐작해 채우지 않는다.
9. 상위 합계와 그 하위 구분이 함께 실리면(North America 와 그 안의 United States · 브랜드그룹과 그 안의 브랜드)
   하위 행의 metric 끝에 _detail 을 붙인다(예 deliveries_detail) — 같은 metric 으로 두면 화면이 합계를 두 번 쌓는다.
값이 하나도 없으면 rows 를 빈 배열로."""

_NULLABLE_INT = {'anyOf': [{'type': 'integer'}, {'type': 'null'}]}
_NULLABLE_STR = {'anyOf': [{'type': 'string'}, {'type': 'null'}]}
SCHEMA = {
  'type': 'object', 'additionalProperties': False, 'required': ['rows'],
  'properties': {'rows': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False,
    'required': ['kind', 'metric', 'label_raw', 'label_ko', 'period_grain', 'period', 'value', 'unit', 'quote', 'page',
                 'definition'],
    'properties': {
      'kind': {'type': 'string', 'enum': ['region', 'model', 'share']},
      'metric': {'type': 'string'},
      'label_raw': {'type': 'string'},
      'label_ko': {'type': 'string'},
      'period_grain': {'type': 'string', 'enum': ['month', 'quarter', 'half', 'ytd', 'year', 'asof']},
      'period': {'type': 'string'},
      'value': {'type': 'number'},
      'unit': {'type': 'string', 'enum': ['units', 'pct', 'share_pct', 'KRW', 'USD', 'EUR', 'VND']},
      'quote': {'type': 'string'},
      'page': _NULLABLE_INT,
      'definition': _NULLABLE_STR,
    }}}},
}


def usd(in_tok: int, out_tok: int) -> float:
  from summarize_customer_docs import usd as _usd   # 단가 정본은 요약기 한 곳
  return _usd(in_tok, out_tok)


def _pages(materials: list[dict], page_count: int) -> list[int]:
  seen = []
  for m in materials:
    p = m.get('page')
    if isinstance(p, int) and 1 <= p <= page_count and p not in seen:
      seen.append(p)
  return seen[:MAX_PAGES]


def build_content(doc: dict, ticker: str, materials: list[dict], content) -> list[dict]:
  """user 메시지 content 블록 — 머리 글 · (PDF) 쪽마다 PNG + 그 쪽 글자층 · (비PDF) 본문."""
  from lib.customer_breakdown import SourcePages
  from lib.customer_doc_pages import render_page
  src = SourcePages(content)
  head = [f'회사 {ticker} · {doc.get("doc_type")} · {doc.get("published_at")} · 제목 {doc.get("title")}', '',
          'C 재료(요약 때 표시한 자리 — 이 자리의 값을 뽑는다):']
  head += [f'- {m.get("kind")} · p.{m.get("page")} · {m.get("note")}' for m in materials] or ['- (없음)']
  blocks = [{'type': 'text', 'text': '\n'.join(head)}]
  if src.is_pdf:
    pages = _pages(materials, len(src.pages))
    for p in pages:
      png = render_page(content.raw, p)
      if png:
        blocks.append({'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png',
                                                   'data': base64.b64encode(png).decode('ascii')}})
      blocks.append({'type': 'text', 'text': f'p.{p} 글자층:\n{src.text_for(p)}'})
    if pages:
      return blocks
  blocks.append({'type': 'text', 'text': f'본문(쪽 없음):\n{src.whole[:MAX_CHARS]}'})
  return blocks


def read_document(llm, doc: dict, ticker: str, materials: list[dict], content) -> tuple[list, tuple[int, int]]:
  """(Row 목록, (입력 토큰, 출력 토큰)). 스키마 밖 행(필드 빠짐·형식 오류)은 버린다. API·JSON·Incomplete 예외는 호출자가
  그 문서만 격리한다(표식을 안 찍어 다음 실행이 다시 집는다)."""
  from lib.customer_breakdown import row_from_dict
  from summarize_customer_docs import _call
  messages = [{'role': 'user', 'content': build_content(doc, ticker, materials, content)}]
  result, _body, tok = _call(llm, SYSTEM, SCHEMA, messages)
  rows = []
  for r in result.get('rows') or []:
    try:
      rows.append(row_from_dict(r, extractor='llm'))
    except TypeError:
      continue
  return rows, tok
