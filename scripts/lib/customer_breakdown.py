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


def verify(r: Row, src: SourcePages) -> tuple[bool, str]:
  """(verified, note) — 결정 C8."""
  why = shape_problem(r)
  if why:
    return False, f'shape:{why}'
  if looks_like_growth(r.quote, r.value):
    return False, 'growth_rate'
  ok, note = quote_check.check_row(r, src.text_for(r.page))
  if ok:
    return True, 'ok'
  if r.second_value is not None:
    same = abs(float(r.second_value) - float(r.value)) <= max(abs(float(r.value)) * 1e-9, 1e-9)
    return (True, 'double_read') if same else (False, 'double_read_mismatch')
  if r.extractor == 'llm':
    return False, f'image_only:{note}'
  return False, note


def _key(r: Row) -> tuple:
  return (r.kind, r.metric, r.label_raw, r.period_grain, r.period)


def payloads(doc: dict, results: list[tuple[Row, bool, str]]) -> tuple[list[dict], int]:
  """(적재 행, 충돌 수). 같은 키가 두 번 오면 먼저 온 것만 — 값이 다르면 충돌로 센다(UNIQUE 위반 방지)."""
  out, seen, conflicts = [], {}, 0
  for r, ok, note in results:
    k = _key(r)
    if k in seen:
      if abs(float(seen[k]) - float(r.value)) > 1e-9:
        conflicts += 1
      continue
    seen[k] = r.value
    d = asdict(r)
    d.pop('second_value')
    out.append({**d, 'company_id': doc['company_id'], 'document_id': doc['id'], 'published_at': doc['published_at'],
                'value': float(r.value), 'verified': bool(ok), 'verify_note': note})
  return out, conflicts


def save_document(ws, doc_id: int, rows: list[dict], *, now: str) -> None:
  """문서 행을 지우고 다시 넣은 뒤 C 처리 표식. 0행 문서도 표식은 찍는다(다시 처리하지 않게).
  SHORTCUT: 지우기·넣기가 한 트랜잭션이 아니다 — 넣기가 실패하면 그 문서 행이 비고 표식도 안 찍혀 다음 실행이 다시 넣는다
  → 원자성이 필요해지면 RPC(함수 하나)로 묶는다."""
  ws.table(TABLE).delete().eq('document_id', doc_id).execute()
  if rows:
    ws.table(TABLE).insert(rows).execute()
  ws.table('customer_doc_summaries').update({'breakdown_at': now}).eq('doc_id', doc_id).execute()
