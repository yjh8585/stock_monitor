"""고객사 IR 문서의 지역별·차종별·점유율 행 — 모양 검사 · 증감률 거르기 · 쪽 글자층 대조 · 두 번째 읽기 · 적재.

계획 = docs/plans/2026-11-11-customers-page-revisions.md 「C」 절(결정 C7·C8). 표 = customer_breakdown_ir(사외비).
호출 = scripts/collect_customer_breakdown.py(--load 소급 · 정기 실행).

- 「수준」 값만 싣는다(C7): 값이 quote 안에서 부호(+·−·괄호)와 함께만 나오면 증감률로 보고 버린다(looks_like_growth).
- 검증(C8): quote_check.check_row 를 «그 쪽» 글자층에 — 다른 쪽 글로는 통과하지 않는다. 글자층에 값이 없는 그림 속
  숫자는 소급 때 서로 모르는 두 번째 읽기(second_value)가 같아야 verified(note 'double_read'). 정기(API · extractor='llm')
  경로는 두 번째 읽기가 없어 'image_only:' 로 남고 화면에 안 뜬다.
- 적재는 문서 단위로 지우고 다시 넣는다(라벨이 바뀐 옛 행이 남지 않게) + customer_doc_summaries.breakdown_at 표식.
"""
import re
from dataclasses import asdict, dataclass, fields

from lib import quote_check

KINDS = ('region', 'model', 'share')
UNITS = ('units', 'pct', 'share_pct', 'KRW', 'USD', 'EUR', 'VND')
EXTRACTORS = ('code', 'llm', 'manual')
PERIOD_RE = {
  'month': re.compile(r'^\d{4}-(0[1-9]|1[0-2])$'),
  'quarter': re.compile(r'^\d{4}-Q[1-4]$'),
  'half': re.compile(r'^\d{4}-H[12]$'),
  'ytd': re.compile(r'^\d{4}-(?:[1-9]|1[0-2])M$'),
  'year': re.compile(r'^\d{4}$'),
  'asof': re.compile(r'^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'),
}
TABLE = 'customer_breakdown_ir'
_GROWTH_MULTS = (1, 1e3, 1e4, 1e6, 1e8, 1e9, 1e12)
_NUM_RE = re.compile(r'([+\-(])?\s*(\d+(?:,\d{3})*(?:\.\d+)?)')


@dataclass
class Row:
  kind: str
  metric: str
  label_raw: str
  label_ko: str
  period_grain: str
  period: str
  value: float
  unit: str
  quote: str
  page: int | None = None
  definition: str | None = None
  extractor: str = 'manual'
  second_value: float | None = None   # 그림 속 숫자의 독립 두 번째 읽기(소급 전용 · 적재하지 않는다)


_ROW_FIELDS = {f.name for f in fields(Row)}


def row_from_dict(d: dict, extractor: str = 'manual') -> Row:
  """JSON 한 행 → Row. 회사·문서 id 는 받지 않는다(문서 행에서 채운다 — 읽은 쪽이 잘못 적어도 다른 문서에 안 붙게)."""
  kw = {k: v for k, v in d.items() if k in _ROW_FIELDS}
  kw.setdefault('extractor', extractor)
  return Row(**kw)


# 결정 C1 — 국내 3사(현대차·기아·KGM)의 지역·차종은 OEM 탭 자료가 맡고 IR 에서는 점유율만 싣는다(공개 상장사 코드).
SHARE_ONLY_TICKERS = frozenset({'005380', '000270', '003620'})


def keep_for_company(ticker: str, rows: list[Row]) -> list[Row]:
  """국내 3사면 점유율 행만 남긴다(결정 C1 · 화면도 같은 규칙으로 IR 지역·차종을 안 그린다).
  SHORTCUT: API 는 문서 전체를 읽고 여기서 버린다 → 비용이 눈에 띄면 지시문·스키마의 kind 를 회사별로 좁힌다."""
  return [r for r in rows if r.kind == 'share'] if ticker in SHARE_ONLY_TICKERS else rows


_SUM_TOL = 0.0005


def suspect_parent_sums(rows: list[Row]) -> list[tuple[str, list[str]]]:
  """상위 합계와 그 하위 구분이 같은 metric 으로 실린 «의심» 묶음 — [(상위 원문 이름, [하위 원문 이름…])]. 행은 안 바꾼다.

  같은 (kind, metric, unit, 기간) 묶음에서 어떤 행 값이 바로 뒤(또는 바로 앞) «연속» 2행 이상의 합과 0.05% 안에서 같으면
  의심으로 낸다. LLM 지시문 규칙 9(하위는 `<metric>_detail`)를 놓치면 화면이 합계를 두 번 쌓는다(GM 인도가 분기 약 2배로
  보인 실사고 2026-11-12 — 값마다 원문과 맞아 verified 로 통과했다). 비율(pct·share_pct)은 쌓지 않아 안 본다.
  하위가 모두 「상위 이름 + 공백」 으로 시작하면(Macan ↔ Macan BEV) 화면 dropSubLabels 몫이라 내지 않는다.
  🔴 자동으로 고치지 않는다 — 소급 자료 실측(2026-11-12)에서 진짜 계층(GM)은 절반쯤만 잡히고(원문 순서가 연속이 아닌 표)
  계층이 없는 모비스 지역 매출에서 우연한 합 일치 5행이 잡혔다. 고치면 멀쩡한 지역이 「세분」 차트로 옮겨진다 → 경고만.
  SHORTCUT: 연속 구간만 본다 → 하위가 흩어져 실리면 못 잡는다 · 오탐이 남는다(작은 묶음에서 우연한 합).
  """
  groups: dict[tuple, list[Row]] = {}
  for r in rows:
    if r.unit in ('pct', 'share_pct') or r.metric.endswith('_detail'):
      continue
    groups.setdefault((r.kind, r.metric, r.unit, r.period_grain, r.period), []).append(r)
  found: dict[tuple[str, tuple[str, ...]], None] = {}
  for g in groups.values():
    for i, p in enumerate(g):
      if p.value <= 0:
        continue
      for step in (1, -1):
        run, s, j = [], 0.0, i + step
        while 0 <= j < len(g) and s <= p.value * (1 + _SUM_TOL):
          run.append(g[j])
          s += g[j].value
          if len(run) >= 2 and abs(s - p.value) <= p.value * _SUM_TOL:
            if not all(k.label_raw.startswith(f'{p.label_raw} ') for k in run):
              found[(p.label_raw, tuple(sorted(k.label_raw for k in run)))] = None
            break
          j += step
  return [(parent, list(kids)) for parent, kids in found]


def shape_problem(r: Row) -> str | None:
  if r.kind not in KINDS:
    return f'kind:{r.kind}'
  if r.unit not in UNITS:
    return f'unit:{r.unit}'
  if r.extractor not in EXTRACTORS:
    return f'extractor:{r.extractor}'
  pat = PERIOD_RE.get(r.period_grain)
  if pat is None:
    return f'grain:{r.period_grain}'
  if not pat.match(str(r.period)):
    return f'period:{r.period}'
  for k in ('metric', 'label_raw', 'label_ko', 'quote'):
    if not str(getattr(r, k) or '').strip():
      return f'empty:{k}'
  try:
    v = float(r.value)
  except (TypeError, ValueError):
    return 'value'
  if v < 0:
    return 'negative'
  if r.unit in ('pct', 'share_pct') and v > 100:
    return 'pct_over_100'
  return None


def looks_like_growth(quote: str, value: float) -> bool:
  """값이 quote 안에서 부호(+ · − · 괄호 음수)와 함께만 나오면 증감률로 본다(C7).
  부호 없이 한 번이라도 나오면 수준 값이다('14.8% share, up from 13.1%'). 값이 안 나오면 False(대조기가 따로 떨군다)."""
  q = quote_check.normalize(quote, squash_ko=False)
  seen_signed = seen_plain = False
  for m in _NUM_RE.finditer(q):
    n = float(m.group(2).replace(',', ''))
    if not any(abs(n * k - float(value)) <= max(abs(float(value)) * 1e-6, 1e-9) for k in _GROWTH_MULTS):
      continue
    if m.group(1):
      seen_signed = True
    else:
      seen_plain = True
  return seen_signed and not seen_plain


class SourcePages:
  """원문 → 쪽별 글자층. PDF 면 쪽마다(1부터) · 아니면 본문 + 표 행 하나(쪽 없음)."""

  def __init__(self, content):
    raw = getattr(content, 'raw', b'') or b''
    self.pages: list[str] | None = None
    if raw[:5] == b'%PDF-':
      import fitz  # pymupdf

      with fitz.open(stream=raw, filetype='pdf') as doc:
        self.pages = [p.get_text() for p in doc]
      self.whole = '\n'.join(self.pages)
    else:
      from lib.doc_text import row_text
      rows = '\n'.join(row_text(r) for t in getattr(content, 'tables', None) or [] for r in t)  # 표 = 세 겹
      self.whole = (getattr(content, 'text', '') or '') + ('\n' + rows if rows else '')

  @property
  def is_pdf(self) -> bool:
    return self.pages is not None

  def text_for(self, page: int | None) -> str:
    if self.pages is None or page is None:
      return self.whole
    return self.pages[page - 1] if 1 <= page <= len(self.pages) else ''


# 배수 표지 — 값이 quote 의 수 × 배수로만 맞을 때 그 배수가 quote 나 «같은 쪽»(표 머리 '(thousand units)')에 적혀 있어야
# 한다. 한글 배수 글자(천·만·억·조)는 흔한 낱말에도 들어가므로 수 바로 뒤·단위 칸 꼴로만 본다.
# 영문 낱글자(k·m·b)도 수·통화 기호 바로 뒤만 본다(검토 2회차) — 낱말 경계로 보면 '357k'·'12.3bn' 은 못 읽고
# 'a.m.'·'3(b)'·'M&A' 에는 걸렸다.
_SUFFIX = r'(?:\d|[$€£])\s?'
_SCALE_MARK = {
  1e2: re.compile(r'hundred|\d\s*백(?!만)|단위\s*[:：]?\s*백(?!만)'),
  1e3: re.compile(rf"thousand|['’‘]000|\(000s?\)|\b000s\b|{_SUFFIX}k(?![a-z])|\d\s*천|천\s*[대명원]|단위\s*[:：]?\s*천"),   # 스텔란티스 'Shipments (000s)'
  1e4: re.compile(r'\d\s*만|만\s*[대명]|단위\s*[:：]?\s*만'),
  1e6: re.compile(rf'million|\bmn\b|{_SUFFIX}mn?(?![a-z&])|백만'),
  1e8: re.compile(r'\d\s*억|억\s*원|단위\s*[:：]?\s*억'),
  1e9: re.compile(rf'billion|\bbn\b|{_SUFFIX}bn?(?![a-z])|십억'),
  1e12: re.compile(rf'trillion|\btn\b|{_SUFFIX}tn(?![a-z])|\d\s*조|조\s*원|단위\s*[:：]?\s*조'),
}


def scale_unmarked(r: Row, page_text: str) -> bool:
  """값이 quote 의 수 그대로가 아니라 배수(×1,000 …)로만 맞는데 그 배수 표지가 quote·그 쪽 어디에도 없다.
  quote_check 는 배수 중 하나로 맞으면 참이라(그쪽 모듈 docstring 「한계」) 'deliveries were 357 vehicles' 를 357,000 대로
  통과시켰다(코드 리뷰 2차 9번). 비율(pct·share_pct)은 배수를 쓰지 않으니 보지 않는다.
  SHORTCUT: 정기 API 행(extractor='llm')에만 건다 — 코드 파서는 표 머리로 배수를 정하고, 소급(manual) 검증 행 2,906 중 788 은
  quote 에 표지가 없어(2026-11-23 실측 · 같은 쪽 본문에 있는지는 원문을 다시 받아야 안다) 재처리 때 대량으로 뒤집힐 수 있다
  → manual 에도 걸려면 그 788 행의 문서를 받아 쪽 본문 표지를 먼저 잰다."""
  if r.extractor != 'llm' or r.unit in ('pct', 'share_pct'):
    return False
  v = float(r.value)
  close = lambda a: abs(a - v) <= max(abs(v) * 1e-9, 1e-9)
  nums = quote_check.numbers_in(r.quote)
  if any(close(n) for n in nums):
    return False
  used = [m for m in quote_check._MULTS if m != 1 and any(close(n * m) for n in nums)]
  text = f'{r.quote}\n{page_text}'.lower()
  return not any(m in _SCALE_MARK and _SCALE_MARK[m].search(text) for m in used)


# 정기 API 행 중 이 비율 이상이 scale_not_in_source 로 떨어지면 「검사가 과할 수 있음」(2026-11-23 사용자 선택 · 제안값)
SCALE_WARN_RATIO = 0.2


def scale_warning(flagged: int, llm_rows: int) -> str | None:
  """한 번의 정기 실행에서 배수 표지 검사(scale_unmarked)가 떨어뜨린 행을 알리는 문구 — 없으면 None.
  검사를 처음 켜 둔 채 실데이터를 못 본 상태라(2026-11-23 정기 API 행 0) 사람이 기억하지 않아도 수집기가 알리게 한다."""
  if not flagged:
    return None
  msg = f'배수 표기 없음(scale_not_in_source) {flagged}/{llm_rows}행'
  if llm_rows and flagged / llm_rows >= SCALE_WARN_RATIO:
    msg += (f' — {SCALE_WARN_RATIO:.0%} 이상이라 검사가 과할 수 있다. verify_note 로 행을 골라 원문 쪽의 단위 표기를'
            ' 확인하고, 맞는 값이면 customer_breakdown._SCALE_MARK 표지를 넓힌다')
  return msg


def verify(r: Row, src: SourcePages) -> tuple[bool, str]:
  """(verified, note) — 결정 C8.
  PDF 는 쪽 번호가 있어야 하고 범위 안이어야 한다(코드 리뷰 2차 9번) — 없으면 문서 전체를 근거로 삼아 다른 쪽의 인용·숫자로
  통과했고, 범위 밖이면 빈 글자층이라 두 번째 읽기만 같으면 double_read 로 통과했다."""
  why = shape_problem(r)
  if why:
    return False, f'shape:{why}'
  if looks_like_growth(r.quote, r.value):
    return False, 'growth_rate'
  if src.is_pdf:
    if r.page is None:
      return False, 'no_page'
    if not 1 <= r.page <= len(src.pages):
      return False, 'page_out_of_range'
  text = src.text_for(r.page)
  ok, note = quote_check.check_row(r, text)
  if ok:
    return (False, 'scale_not_in_source') if scale_unmarked(r, text) else (True, 'ok')
  # 두 번째 읽기는 «그림 속 숫자»(인용은 그 쪽에 있고 값만 밖)를 위한 것 — 인용 자체가 그 쪽에 없으면 받지 않는다
  # (검토 2회차 · 기존 double_read 64행은 전부 value_not_in_quote 라 뒤집히는 행 0)
  if r.second_value is not None and note.startswith('value_not_in_quote'):
    same = abs(float(r.second_value) - float(r.value)) <= max(abs(float(r.value)) * 1e-9, 1e-9)
    return (True, 'double_read') if same else (False, 'double_read_mismatch')
  if r.extractor == 'llm':
    return False, f'image_only:{note}'
  return False, note


def _key(r: Row) -> tuple:
  return (r.kind, r.metric, r.label_raw, r.period_grain, r.period)


def payloads(doc: dict, results: list[tuple[Row, bool, str]]) -> tuple[list[dict], int]:
  """(적재 행, 충돌 수). 같은 키가 두 번 오면 하나만 남긴다(UNIQUE 위반 방지) — 값이 다르면 충돌로 센다.
  값이 같으면 검증된 쪽을 남긴다: 먼저 온 행이 다른 쪽 quote 라 검증에 실패하고 뒤 행이 통과했는데 먼저 온 것만
  남기면, 맞는 값이 화면(verified 만)에서 사라진다(2026-11-20 코드 리뷰 8번 (나))."""
  out, seen, conflicts = [], {}, 0
  for r, ok, note in results:
    k = _key(r)
    d = asdict(r)
    d.pop('second_value')
    row = {**d, 'company_id': doc['company_id'], 'document_id': doc['id'], 'published_at': doc['published_at'],
           'value': float(r.value), 'verified': bool(ok), 'verify_note': note}
    if k in seen:
      prev = out[seen[k]]
      if abs(prev['value'] - row['value']) > 1e-9:
        conflicts += 1
      # 값이 달라도 검증된 쪽이 이긴다(검토 2회차) — 미검증 행은 화면에 안 나오니 남겨 봐야 검증된 값만 가린다
      if ok and not prev['verified']:
        out[seen[k]] = row
      continue
    seen[k] = len(out)
    out.append(row)
  return out, conflicts


def save_document(ws, doc_id: int, rows: list[dict], *, now: str) -> None:
  """문서 행을 지우고 다시 넣은 뒤 C 처리 표식. 0행 문서도 표식은 찍는다(다시 처리하지 않게).
  🔴 지우기 «전에» 표식부터 지운다 — 재처리(--doc-id·--load)는 이미 표식이 찍힌 문서라, 넣기가 실패하면 옛 표식이
  남아 정기 실행(breakdown_at is null)이 영영 안 집고 문서 행만 빈 채로 남았다(2026-11-20 코드 리뷰 8번 (가)).
  SHORTCUT: 지우기·넣기가 한 트랜잭션이 아니다 — 넣기가 실패하면 그 문서 행이 잠시 비지만 표식이 비어 있어 다음 정기
  실행이 다시 넣는다 → 그 사이 빈 화면도 안 되면 RPC(함수 하나)로 묶는다."""
  ws.table('customer_doc_summaries').update({'breakdown_at': None}).eq('doc_id', doc_id).execute()
  ws.table(TABLE).delete().eq('document_id', doc_id).execute()
  if rows:
    ws.table(TABLE).insert(rows).execute()
  ws.table('customer_doc_summaries').update({'breakdown_at': now}).eq('doc_id', doc_id).execute()
