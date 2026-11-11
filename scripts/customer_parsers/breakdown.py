"""지역·차종·점유율 «수준» 값 코드 파서(C-3) — 스텔란티스 EDGAR 6-K · 폴라리스 EDGAR 8-K · 포르쉐 팩트시트 XLSX.

계획 = docs/plans/2026-11-11-customers-page-revisions.md 「Task C-3」. 행 꼴·검사 = lib/customer_breakdown.py(Row · verify).
숫자 수집기 등록부(customer_parsers.MODULE_NAMES)에 넣지 않는다 — collect_customer_breakdown.py 만 부른다.

parse(ticker, doc, content) →
  None            이 문서는 코드 몫이 아니다(그 회사 파서가 없거나 서식 표지가 없다) → 정기 실행은 API 읽기로
  (rows, unknown) 서식을 알아봤다. rows 가 비면 꼴이 바뀐 것 → 호출부가 처리 표식을 찍지 않고 경고한다.
                  unknown = 처음 보는 권역·차종 라벨(행을 만들지 않는다 — 엉뚱한 권역에 붙이지 않게) → 라벨 사전에 더할 것.

인용(quote)은 원문 표 행의 연속 구간(row_text 의 부분 문자열) · 열 고르기는 머리 글로 한다(quote_check 는 열을 잘못
골라도 같은 행 안의 숫자면 통과시킨다 — 열 선택은 파서 책임).

실물(2026-11-12 · 문서 229·236·242·250 / 2·4·8·10 / 2149~2151·2169)로 확인한 꼴:
- 스텔란티스: 표 행 「NORTH AMERICA | ENLARGED EUROPE」(권역 머리 · 1~2칸) 다음 「€ million, except as otherwise stated |
  Q3 2026 | Q3 2025 | Change | € million… | …」(블록마다 기간 머리) 다음 「Shipments (000s) | 357 | 404 | (47) | Shipments
  (000s) | 588 | …」. 합작사가 있는 권역(중동·아프리카 · 중국·인도·아태)은 Combined/Consolidated 두 행 — 오른쪽 블록이
  먼저 끝나면 다음 행은 왼쪽 블록만 있다(「Consolidated shipments | 228 | 209 | +19」). 기간 머리 = 분기 · YTD · H2 · 연도.
  점유율은 문장이다 — 지역 이름이 같은 문장 앞에 붙은 꼴(「North America market share increased to 7.5%」)만 잡는다.
  남미·중동 문장(「regional leadership with an 18.6% market share」)은 지역이 앞 문단에만 있어 코드가 안 잡는다
  (SHORTCUT: 문단 머리로 지역을 이어 받으면 잡힌다 → 소급(C-5)·API 읽기가 메운다).
- 폴라리스: 문장 「North America sales of $1,815 million represented 89 percent of total Company sales and increased 14
  percent from $1,586 million in the third quarter of 2025」 · International 같은 꼴(전년 값 없음). 4분기판은 전년 값이
  「from $1,481 million in 2024」 라 분기인지 모른다 → 「in the <서수> quarter of YYYY」 일 때만 전년 행을 낸다.
  부문 매출 표 「Q3 2026 | Q3 2025 | Change | …」 다음 「Polaris Powersports | $ | 1,822.1 | $ | 1,543.2 | 18 | % | …」.
- 포르쉐: porsche.fetch 가 만든 시트 표 — '03 - Sales_deliveries by Region'·'04 - Sales_deliveries by Model' 의 분기 단독
  블록(porsche._fs_block — 누계 블록은 안 읽는다). 빈 칸 = 그 분기 없음. 팩트시트의 모든 분기를 담는다(계획서 C 상세).
"""
import re

from customer_parsers.base import to_number
from customer_parsers.porsche import _fs_block, _FS_DLV_SHEET, _FS_INT
from lib.customer_breakdown import Row
from lib.doc_text import norm_text, row_text

_NUM = re.compile(r'\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?')   # 음수·괄호(증감 칸)는 수준 값이 아니다
_ORD = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4}

# ── 스텔란티스 ───────────────────────────────────────────────────────────────
STLA_REGIONS = {
  'NORTH AMERICA': '북미',
  'ENLARGED EUROPE': '확대 유럽',
  'MIDDLE EAST & AFRICA': '중동·아프리카',
  'SOUTH AMERICA': '남미',
  'CHINA AND INDIA & ASIA PACIFIC': '중국·인도·아시아태평양',   # 2025 까지의 부문 이름
  'CHINA AND INDIA & PACIFIC': '중국·인도·아시아태평양',        # FY 2025 판 H2 표의 원문 오기 — 한국어 라벨은 위와 같게
  'ASIA PACIFIC': '아시아태평양',                                # 2026 1분기판부터의 부문 이름
  'MASERATI': '마세라티(브랜드 부문)',
}
STLA_DEF = {
  'shipments': '스텔란티스 부문별 연결 출하(공장 → 딜러·유통사 · 합작사 제외 · 천 대 단위 발표)',
  'combined_shipments': '스텔란티스 부문별 합산 출하(연결 출하 + 연결하지 않는 합작사 출하 · 천 대 단위 발표)',
}
STLA_SHARE_KO = {'North America': '북미', 'EU30': '유럽(EU30)', 'Enlarged Europe': '확대 유럽', 'South America': '남미',
                 'Middle East & Africa': '중동·아프리카', 'Middle East and Africa': '중동·아프리카', 'Brazil': '브라질',
                 'Argentina': '아르헨티나', 'India': '인도', 'China': '중국'}
STLA_SHARE_DEF = '스텔란티스 발표 시장 점유율(승용+경상용 · 회사가 인용한 제3자 산업 통계 · 리프모터 제외 값)'
_STLA_SHARE = re.compile(r'\b(' + '|'.join(re.escape(k) for k in STLA_SHARE_KO) + r') market share '
                         r'(?:was|increased to|decreased to|rose to|fell to|declined to|grew to|reached) '
                         r'(\d{1,2}(?:\.\d{1,2})?)%')
_EUR_HEAD = re.compile(r'€ million(?:,.*)?')
_SHIP = re.compile(r'(Combined |Consolidated )?[Ss]hipments(?: \(\d+\))*(?: \(000s\))?')
_UPPER = re.compile(r"[A-Z][A-Z &'.,-]*[A-Z]")
_NOT_LABEL = {'bps', 'n.m.', 'nm', '%', '-', '$'}


def _filled(row) -> list[tuple[int, str]]:
  return [(i, norm_text(c)) for i, c in enumerate(row) if norm_text(c)]


def _long_enough(cells: list[str], n: int) -> str:
  """앞 n 칸의 row_text — 정규화 뒤 12자 미만이면 뒤 칸을 이어 붙인다(quote_check 는 '|' 를 지우고 12자 미만 인용은
  글자 라벨이 있어야 인정한다 → '911 | 11,683' 은 숫자뿐이라 원문에 있어도 떨어진다)."""
  from lib.quote_check import MIN_FRAG, normalize
  while n < len(cells) and len(normalize(row_text(cells[:n]))) < MIN_FRAG:
    n += 1
  return row_text(cells[:n])


def _is_label(c: str) -> bool:
  return bool(re.search(r'[A-Za-z]', c)) and c.lower() not in _NOT_LABEL


def _stla_period(cell: str, doc_q: int | None) -> tuple[str, str] | None:
  c = norm_text(cell)
  if m := re.fullmatch(r'Q([1-4]) (20\d\d)', c):
    return 'quarter', f'{m[2]}-Q{m[1]}'
  if m := re.fullmatch(r'H([12]) (20\d\d)', c):
    return 'half', f'{m[2]}-H{m[1]}'
  if m := re.fullmatch(r'(?:FY )?(20\d\d)', c):
    return 'year', m[1]
  if (m := re.fullmatch(r'YTD (20\d\d)', c)) and doc_q:
    return ('year', m[1]) if doc_q == 4 else ('ytd', f'{m[1]}-{doc_q * 3}M')
  return None


def _stla_heads(tables) -> list[list[tuple[int, str]]]:
  return [_filled(r) for t in tables for r in t if r and _filled(r) and _EUR_HEAD.fullmatch(_filled(r)[0][1])]


def parse_stellantis(doc: dict, content) -> tuple[list[Row], list[str]] | None:
  tables = getattr(content, 'tables', None) or []
  heads = _stla_heads(tables)
  qs = [m for h in heads if len(h) > 1 and (m := re.fullmatch(r'Q([1-4]) 20\d\d', h[1][1]))]
  doc_q = int(qs[0][1]) if qs else None
  main = next((p for h in heads if len(h) > 1 and (p := _stla_period(h[1][1], doc_q))), None)
  rows: list[Row] = []
  unknown: list[str] = []
  saw_region = False
  for t in tables:
    regions = blocks = None
    combined: set[int] = set()
    consolidated: set[int] = set()
    for raw in t:
      cells = _filled(raw)
      if not cells:
        continue
      texts = [c for _, c in cells]
      if len(texts) <= 2 and all(_UPPER.fullmatch(c) for c in texts):
        regions, blocks = texts, None   # 새 권역 표
        continue
      if _EUR_HEAD.fullmatch(texts[0]):
        pos = [k for k, (_, c) in enumerate(cells) if _EUR_HEAD.fullmatch(c)]
        if regions and len(pos) == len(regions):
          blocks = [(regions[b], _stla_period(cells[k + 1][1], doc_q) if k + 1 < len(cells) else None,
                     _stla_period(cells[k + 2][1], doc_q) if k + 2 < len(cells) else None) for b, k in enumerate(pos)]
          saw_region = True
        else:
          blocks = None   # 권역 머리 없는 표(그룹 요약) · 칸 수가 안 맞는 머리 — 읽지 않는다
        regions, combined, consolidated = None, set(), set()
        continue
      if not blocks:
        continue
      labels = [k for k, (_, c) in enumerate(cells) if _is_label(c)]
      for li, k in enumerate(labels):
        m = _SHIP.fullmatch(cells[k][1])
        if not m:
          continue
        if len(labels) == len(blocks):
          b = li
        else:   # 오른쪽 블록이 먼저 끝난 짧은 행 — Combined 를 먼저 낸 블록의 Consolidated 일 때만 어디인지 안다
          cand = [x for x in combined - consolidated] if m[1] == 'Consolidated ' else []
          if len(blocks) == 1:
            b = 0
          elif len(cand) == 1:
            b = cand[0]
          else:
            continue
        if b >= len(blocks):
          continue
        region, cur_p, prv_p = blocks[b]
        if region not in STLA_REGIONS:
          if region not in unknown:
            unknown.append(region)
          continue
        metric = 'combined_shipments' if m[1] == 'Combined ' else 'shipments'
        (combined if metric == 'combined_shipments' else consolidated).add(b)
        tail = cells[k + 1:k + 4]
        end = tail[-1][0] if tail else cells[k][0]
        quote = row_text(raw[cells[k][0]:end + 1])
        for per, (_, val) in zip((cur_p, prv_p), tail[:2]):
          if per and _NUM.fullmatch(val):
            rows.append(Row('region', metric, region, STLA_REGIONS[region], per[0], per[1],
                            round(to_number(val) * 1000), 'units', quote, None, STLA_DEF[metric], 'code'))
  if not saw_region:
    return None
  if main:
    seen = set()
    for m in _STLA_SHARE.finditer(norm_text(getattr(content, 'text', '') or '')):
      if m[1] in seen:
        continue
      seen.add(m[1])
      rows.append(Row('share', 'market_share', m[1], STLA_SHARE_KO[m[1]], main[0], main[1], float(m[2]), 'share_pct',
                      m[0], None, STLA_SHARE_DEF, 'code'))
  return rows, unknown


# ── 폴라리스 ────────────────────────────────────────────────────────────────
PII_REGIONS = {'North America': '북미', 'International': '북미 외(International)'}
# 2026 부문 = Powersports·Marine·Aixam & Goupil · 2025 4분기판까지 = Off Road·On Road·Marine(회사 구분 그대로 · 이어 붙이지 않는다)
PII_SEGMENTS = {'Polaris Powersports': '파워스포츠 부문', 'Marine': '마린 부문', 'Aixam & Goupil': '아이삼·구필 부문',
                'Off Road': '오프로드 부문', 'On Road': '온로드 부문'}
PII_SKIP = {'Corporate'}   # 부문이 아니라 본사 조정 행
PII_DEF = {
  'sales': '폴라리스 지역별 매출(백만 달러 발표 · 북미 / 그 밖 International 둘로만 나눈다)',
  'sales_mix': '폴라리스 지역별 매출이 회사 전체 매출에서 차지하는 비중(%)',
  'segment': '폴라리스 사업 부문별 매출(백만 달러 발표 · 차종이 아니라 부문)',
}
_PII_SENT = re.compile(
  r'(North America|International) sales of \$(\d{1,3}(?:,\d{3})*(?:\.\d+)?) million represented (\d{1,3}) percent of '
  r'total [Cc]ompany sales(?:[^.$]*?(from \$(\d{1,3}(?:,\d{3})*(?:\.\d+)?) million in the (first|second|third|fourth) '
  r'quarter of (20\d\d)))?')
_PII_HEAD = re.compile(r'Q([1-4]) (20\d\d)')


def parse_polaris(doc: dict, content) -> tuple[list[Row], list[str]] | None:
  tables = getattr(content, 'tables', None) or []
  head = None
  for t in tables:
    for i, raw in enumerate(t):
      cells = [c for _, c in _filled(raw)]
      if len(cells) >= 3 and (a := _PII_HEAD.fullmatch(cells[0])) and (b := _PII_HEAD.fullmatch(cells[1])) \
          and cells[2] == 'Change' and a[1] == b[1] and int(a[2]) == int(b[2]) + 1:
        head = (t, i, int(a[1]), int(a[2]))
        break
    if head:
      break
  text = norm_text(getattr(content, 'text', '') or '')
  sents = list(_PII_SENT.finditer(text))
  if head is None or not sents:
    return None
  t, i, q, y = head
  cur, prv = f'{y}-Q{q}', f'{y - 1}-Q{q}'
  rows: list[Row] = []
  seen = set()
  for m in sents:
    lab = m[1]
    if lab in seen:
      continue
    seen.add(lab)
    ko = PII_REGIONS[lab]
    q1 = m[0][:m[0].index(' percent') + len(' percent')]   # 「… sales of $X million represented N percent」
    rows.append(Row('region', 'sales', lab, ko, 'quarter', cur, round(to_number(m[2]) * 1e6), 'USD', q1, None,
                    PII_DEF['sales'], 'code'))
    rows.append(Row('region', 'sales_mix', lab, ko, 'quarter', cur, float(m[3]), 'pct', q1, None, PII_DEF['sales_mix'],
                    'code'))
    if m[4] and _ORD[m[6]] == q and int(m[7]) == y - 1:
      rows.append(Row('region', 'sales', lab, ko, 'quarter', prv, round(to_number(m[5]) * 1e6), 'USD', m[4], None,
                      PII_DEF['sales'], 'code'))
  unknown: list[str] = []
  for raw in t[i + 1:i + 8]:   # 부문 표는 머리 바로 아래 몇 행 — 매출총이익 표의 같은 이름 행까지 내려가지 않는다
    cells = _filled(raw)
    if not cells:
      continue
    lab = cells[0][1]
    nums = [(k, c) for k, c in cells[1:] if c != '$']
    if len(nums) < 2 or not (_NUM.fullmatch(nums[0][1]) and _NUM.fullmatch(nums[1][1])):
      break   # 표가 끝났다
    if lab in PII_SKIP:
      continue
    if lab not in PII_SEGMENTS:
      unknown.append(lab)
      continue
    quote = row_text(raw[cells[0][0]:nums[1][0] + 1])
    for per, (_, val) in ((cur, nums[0]), (prv, nums[1])):
      rows.append(Row('model', 'sales', lab, PII_SEGMENTS[lab], 'quarter', per, round(to_number(val) * 1e6), 'USD',
                      quote, None, PII_DEF['segment'], 'code'))
  return rows, unknown


# ── 포르쉐 ──────────────────────────────────────────────────────────────────
PORSCHE_REGIONS = {
  'Germany': '독일',
  'North America (excluding Mexico)': '북미(멕시코 제외)',
  'China (including Hong Kong)': '중국(홍콩 포함)',
  'Europe (excluding Germany)': '유럽(독일 제외)',
  'Overseas and Emerging Markets': '해외·신흥시장',
}
PORSCHE_MODELS = {
  '911': '911', '718': '718', 'Cayenne': '카이엔', 'Cayenne ICE/PHEV': '카이엔 내연·PHEV', 'Cayenne BEV': '카이엔 전기차',
  'Panamera': '파나메라', 'Macan': '마칸', 'Macan ICE': '마칸 내연', 'Macan BEV': '마칸 전기차', 'Taycan': '타이칸',
}
PORSCHE_SKIP = {'Deliveries to customers', 'Vehicle sales'}   # 합계(물량 표에 있다)·판매(인도와 다른 지표)
PORSCHE_DEF = {'region': '포르쉐 AG 지역별 고객 인도(IR 팩트시트 · 분기 단독)',
               'model': '포르쉐 AG 차종별 고객 인도(IR 팩트시트 · 분기 단독 · 파생 모델 행은 회사 구분 그대로)'}
_MODEL_SHEET = re.compile(r'deliveries by Model', re.I)


def parse_porsche(doc: dict, content) -> tuple[list[Row], list[str]] | None:
  if doc.get('doc_type') != 'fact_sheet':
    return None
  sheets = {t[0][0]: t[1:] for t in getattr(content, 'tables', None) or [] if t and t[0]}
  rows: list[Row] = []
  unknown: list[str] = []
  found = False
  for kind, sheet_rx, names in (('region', _FS_DLV_SHEET, PORSCHE_REGIONS), ('model', _MODEL_SHEET, PORSCHE_MODELS)):
    body = next((r for n, r in sheets.items() if sheet_rx.search(n)), None)
    block = _fs_block(body, 'Units') if body is not None else None
    if block is None:
      continue
    found = True
    cols, brows = block
    for raw in brows:
      lab = norm_text(raw[0]) if raw else ''
      if not lab or lab in PORSCHE_SKIP:
        continue
      if lab not in names:
        if lab not in unknown:
          unknown.append(lab)
        continue
      for k, (y, q) in sorted(cols.items()):
        cell = norm_text(raw[k]) if k < len(raw) else ''
        if not cell:
          continue
        if not _FS_INT.fullmatch(cell) or to_number(cell) <= 0:
          continue
        quote = _long_enough([c for c in raw if norm_text(c)], sum(1 for c in raw[:k + 1] if norm_text(c)))
        rows.append(Row(kind, 'deliveries', lab, names[lab], 'quarter', f'{y}-Q{q}', round(to_number(cell)), 'units',
                        quote, None, PORSCHE_DEF[kind], 'code'))
  return (rows, unknown) if found else None


PARSERS = {'STLA': parse_stellantis, 'PII': parse_polaris, 'P911.DE': parse_porsche}


def parse(ticker: str, doc: dict, content) -> tuple[list[Row], list[str]] | None:
  fn = PARSERS.get(ticker)
  return fn(doc, content) if fn else None
