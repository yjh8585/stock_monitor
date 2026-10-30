"""MarkLines 중국 엑셀 3종 → oem_china_* upsert 행 변환 (순수 함수).

입력은 시트 하나의 행 리스트(헤더 포함, 셀 값 그대로)이고 출력은 PK 단위로 합산된 dict 리스트다.
파일 열기·다운로드·DB 는 import_oem_china.py / sync_oem_china_excel.py 가 맡는다.

| 파일              | 함수                  | 테이블                       |
| ----------------- | --------------------- | ---------------------------- |
| Displacement/NEV  | parse_nev_sheet       | oem_china_production_month   |
| Passenger Cars    | parse_passenger_sheet | oem_china_segment_month      |
| Export Volume     | parse_export_sheet    | oem_china_export_month       |

- 세 파일 모두 승용(PASSENGER_TYPES)만 남긴다 — NEV·승용차 파일엔 트럭·버스 행이 섞여 있다.
  수출 파일엔 차종 열이 없지만 승용 전용이다(2026-10-29 모델명 대조 실측). 승용도 상용도 아닌 차종
  표기가 나오면 멈춘다(is_passenger — 표기가 바뀐 승용 행이 조용히 빠지지 않게).
- NEV 와 승용차 파일은 같은 생산을 다르게 쪼갠 것이라 **전 차종 월합이 정확히 같다** →
  두 파서가 all_types_total 을 함께 돌려주고 import 가 교차 검증한다.
- 그룹은 「중국 모회사」 기준이다. 해마다 바뀐 표기를 GROUP_ALIASES 로 맞추고(짧은 표시명으로),
  모회사가 'n.a.' 이면 브랜드명을 넣는다(테슬라·위에다기아·MINI — 사용자 선택 2026-10-29).
  브랜드 칸은 「(2022-)」 같은 시작 연도 꼬리만 뗀다(canonical_brand — 같은 브랜드가 연도로 갈리지 않게).
- 'Adjusted value'(연 단위 보정) 열은 월에 배분할 수 없어 버린다.
경위·결정 = docs/plans/2026-10-29-oem-china-tab.md
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime

PASSENGER_TYPES = frozenset({'Sedan/Hatchback', 'SUV', 'MPV', 'Mini Van'})
#: 상용 차종 표기 — 대소문자·「(Chassis)」 꼬리가 해마다 갈려(Heavy Trucks · Heavy trucks) 목록 대신 낱말로 본다.
_COMMERCIAL_TYPE_RE = re.compile(r'truck|bus|trailer', re.IGNORECASE)
#: 브랜드 칸의 시작 연도 꼬리 — 'MG (2006-)' · 'Mercedes-Benz (2022-)'.
_BRAND_SINCE_RE = re.compile(r'\s*\((?:19|20)\d\d-?\)$')

#: 모회사가 없는 행의 표기. 브랜드명으로 바꿔 넣는다.
NA_GROUP = 'n.a.'

#: 원문 그룹 표기 → 표시명. 해마다 바뀐 이름(Chery Automobile→Chery Group 등)을 하나로 묶는다.
#: 없는 이름은 원문 그대로 쓴다 — 새 그룹이 나타나도 조용히 사라지지 않는다.
GROUP_ALIASES = {
  'BYD Auto': 'BYD',
  'SAIC (Shanghai Automotive Industry Corporation (Group))': 'SAIC',
  'Geely Holding Group': 'Geely',
  'Chery Group': 'Chery',
  'Chery Automobile': 'Chery',
  'FAW (China FAW Group Corp.)': 'FAW',
  'GAC Group': 'GAC',
  'Guangzhou Automobile Group': 'GAC',
  'Changan/Chana (Changan Automobile (Group))': 'Changan',
  'Great Wall Motor (GWM)': 'GWM',
  'Dongfeng (Dongfeng Motor Corporation)': 'Dongfeng',
  'BAIC Group': 'BAIC',
  'Brilliance Automobile Group': 'Brilliance',
  'Xiaomi Corporation': 'Xiaomi',
  'Seres Group': 'Seres',
  'SERES (2022-)': 'Seres',
  'Chongqing Sokon Industry Group': 'Seres',  # 2022 세레스로 개명
  'Jiangling Motors Co. Group': 'JMC',
  'Jiangling Motors Co. Group (2022-)': 'JMC',
  'Anhui Jianghuai Automotive Group': 'JAC',
  'Haima Automobile': 'Haima',
  'Haima (Zhengzhou) Automobile': 'Haima',
  'Fujian Motor Industry Group Co. (FJMG)': 'FJMG',
  'Fujian Motor Industrial Group Co. (FJMG)': 'FJMG',
  'China National Heavy Duty Truck Group': 'Sinotruk',
  # 모회사 n.a. → 브랜드로 대체된 이름도 해마다 표기가 갈린다(2018~2026 시트 실측)
  'Xiaopeng Motor': 'XPeng',
  'Lixiang Automotive': 'Li Auto',
  'LETIN': 'Letin Motor',
  'DS (2021-)': 'DS',
  'SITECH (2021-)': 'SITECH',
  'Beijing Automobile Works': 'BAW',
  'Beijing Automobile Works (2017-)': 'BAW',
  'Yibin Kaiyi (2017-)': 'Kaiyi',
  'Neta': 'Hozon Auto',  # 수출 파일은 호존을 브랜드(Neta)로만 적은 해가 있다
}

#: NEV 「HV/PHV/EV」 토큰 → 화면 파워트레인. 판매 쪽 import_oem_sales.normalize_powertrain 과
#: 같은 우선순위(EV > FCEV > PHEV > HV > ICE)로 복합 토큰을 하나로 고른다(MHV 는 HV 로 묶는다).
#: 값은 판매 쪽(FCV·빈칸=Other)이 아니라 회사 탭 어휘(CompanyPowertrain — FCEV·빈칸=ICE)를 쓴다.
_PT_TOKEN = {'EV': 'EV', 'FCV': 'FCEV', 'PHV': 'PHEV', 'PHEV': 'PHEV', 'HV': 'HV', 'MHV': 'HV', 'ICE': 'ICE'}
_PT_PRIORITY = ('EV', 'FCEV', 'PHEV', 'HV', 'ICE')

_MONTH_ABBR = {m: i for i, m in enumerate(
  ('jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'), start=1)}


@dataclass
class ParseResult:
  rows: list[dict]
  #: 트럭·버스까지 포함한 월별 합 {YYYYMM: 대수} — NEV·승용차 교차 검증용.
  all_types_total: dict[int, int] = field(default_factory=dict)


def _text(v) -> str:
  if isinstance(v, float) and v.is_integer():
    v = int(v)  # .xls 는 숫자 브랜드(BAIC 의 「212」)를 212.0 으로 준다
  return '' if v is None else str(v).strip()


def _num(v) -> int:
  """셀 값 → 정수. 빈칸·'-'·문자는 0."""
  if isinstance(v, bool):
    return 0
  if isinstance(v, (int, float)):
    return int(round(v))
  return 0


def canonical_group(group, brand) -> str:
  """원문 모회사·브랜드 → 저장할 cn_group."""
  g = _text(group)
  if not g or g == NA_GROUP:
    g = _text(brand) or NA_GROUP
  return GROUP_ALIASES.get(g, g)


def canonical_brand(brand) -> str:
  """원문 브랜드 → 저장할 브랜드. 시작 연도 꼬리만 떼고 나머지는 원문 그대로 둔다."""
  return _BRAND_SINCE_RE.sub('', _text(brand))


def is_passenger(vehicle_type: str) -> bool:
  """승용이면 True, 상용(트럭·버스·트레일러·n.a.)이면 False.

  🔴 둘 다 아니면 ValueError — 승용 표기가 바뀐 것(Mini Van → Minivan)을 상용으로 버리면 그 행이
  stale 로 잡혀 DB 에서 조용히 지워진다(교차 검증은 전 차종 합이라 못 잡는다).
  """
  if vehicle_type in PASSENGER_TYPES:
    return True
  if vehicle_type == NA_GROUP or _COMMERCIAL_TYPE_RE.search(vehicle_type):
    return False
  raise ValueError(f'모르는 차종 표기 {vehicle_type!r} — PASSENGER_TYPES 나 상용 판정에 추가할 것')


def stale_keys(existing: set[tuple], fresh: set[tuple], max_ratio: float) -> set[tuple]:
  """파일이 덮는 기간의 DB 키 중 파일에 없는 것(= 지울 키).

  🔴 그 수가 기존의 max_ratio 를 넘으면 RuntimeError — 파싱이 깨졌거나 표기가 통째로 바뀐 것이다.
  upsert «전»에 불러야 한다(뒤에 부르면 멈추기 전에 새 키가 들어가 옛 키와 이중으로 세진다).
  """
  stale = existing - fresh
  if stale and len(stale) > max_ratio * len(existing):
    raise RuntimeError(
      f'지울 행 {len(stale):,} / 기존 {len(existing):,} 이 {max_ratio:.0%} 를 넘는다 — '
      f'파싱 고장 의심, 적재하지 않고 멈춘다. 예: {sorted(stale)[:3]}'
    )
  return stale


def normalize_powertrain(raw) -> str:
  """NEV 「HV/PHV/EV」 셀 → ICE·HV·PHEV·EV·FCEV. 빈칸은 ICE.

  🔴 모르는 토큰이 나오면 ValueError — 조용히 ICE 로 세면 NEV 비중이 소리 없이 줄어든다.
  """
  s = _text(raw)
  if not s:
    return 'ICE'
  tokens = [t.strip() for t in s.split('/') if t.strip()]
  unknown = [t for t in tokens if t not in _PT_TOKEN]
  if unknown:
    raise ValueError(f'모르는 파워트레인 토큰 {unknown} (원문 {s!r}) — _PT_TOKEN 에 매핑을 추가할 것')
  mapped = {_PT_TOKEN[t] for t in tokens}
  return next(pt for pt in _PT_PRIORITY if pt in mapped)


def _sum_into(acc: dict, key: tuple, ym: int, v: int) -> None:
  if v:
    acc[key + (ym,)] = acc.get(key + (ym,), 0) + v


def parse_nev_sheet(year: int, rows: list[tuple]) -> ParseResult:
  """Displacement/NEV 시트 1개(연도 1개) → oem_china_production_month 행.

  헤더(1행): Maker/Brand | Group | Manufacturer | Type | Model | Details | HV/PHV/EV | 월 12(날짜) | …
  2행은 「Engine displacement, etc.」 부제라 데이터가 아니다. 파워트레인 열은 2018 시트부터 있다.
  트림(Details) 단위 행을 (모회사, 브랜드, 차종, 모델, 파워트레인, 월)로 합산한다.
  """
  header = [_text(h) if not isinstance(h, (date, datetime)) else h for h in rows[0]]
  # 파워트레인 열 이름은 2018 시트만 'HV/PHV/EV\n[NEW]' 라 앞부분으로 찾는다
  pt_col = next((c for c, h in enumerate(header) if isinstance(h, str) and h.startswith('HV/PHV/EV')), None)
  if header[:5] != ['Maker/Brand', 'Group', 'Manufacturer', 'Type', 'Model'] or pt_col is None:
    raise ValueError(f'NEV {year} 시트 헤더가 예상과 다르다: {header[:8]}')
  month_cols = {}
  for c, h in enumerate(header):
    if isinstance(h, (date, datetime)) and h.year == year:
      month_cols[c] = year * 100 + h.month
  if len(month_cols) != 12 or min(month_cols) != pt_col + 1:
    raise ValueError(f'NEV {year} 시트의 월 열이 12개가 아니거나 자리가 다르다: {sorted(month_cols.values())}')

  acc: dict[tuple, int] = {}
  all_types: dict[int, int] = {}
  for r in rows[1:]:
    if len(r) <= max(month_cols) or not _text(r[4]):
      continue  # 부제 행·빈 행
    for c, ym in month_cols.items():
      all_types[ym] = all_types.get(ym, 0) + _num(r[c])
    vehicle_type = _text(r[3])
    if not is_passenger(vehicle_type):
      continue
    key = (canonical_group(r[1], r[0]), canonical_brand(r[0]), vehicle_type, _text(r[4]),
           normalize_powertrain(r[pt_col]))
    for c, ym in month_cols.items():
      _sum_into(acc, key, ym, _num(r[c]))

  out = [
    {'cn_group': g, 'maker_brand': b, 'vehicle_type': t, 'model': m, 'powertrain': pt,
     'year_month': ym, 'production': v}
    for (g, b, t, m, pt, ym), v in acc.items() if v
  ]
  return ParseResult(out, {ym: v for ym, v in all_types.items() if v})


def parse_passenger_sheet(rows: list[tuple]) -> ParseResult:
  """Passenger Cars 엑셀(한 해) → oem_china_segment_month 행.

  1행은 「(units)」, 2행이 헤더: Country | Group | Maker/Brand | Type | Segment | Model | YYYYMM … | 반기 합 …
  월 열은 헤더 값이 YYYYMM 숫자인 열이다(반기·조정·합계 열은 문자라 걸러진다). 값의 '-' 는 0.
  """
  header = rows[1]
  if tuple(_text(h) for h in header[:6]) != ('Country', 'Group', 'Maker/Brand', 'Type', 'Segment', 'Model'):
    raise ValueError(f'승용차 엑셀 헤더가 예상과 다르다: {header[:7]}')
  month_cols = {c: int(h) for c, h in enumerate(header) if isinstance(h, (int, float)) and 200000 < h < 300000}
  if not month_cols:
    raise ValueError('승용차 엑셀에서 YYYYMM 월 열을 찾지 못했다')

  acc: dict[tuple, int] = {}
  all_types: dict[int, int] = {}
  for r in rows[2:]:
    if len(r) <= max(month_cols) or not _text(r[0]):
      continue
    if _text(r[0]) != 'China':
      raise ValueError(f'중국 외 국가 행이 섞였다: {r[0]!r} — 다른 다운로드 방식(전 국가)을 받은 것')
    for c, ym in month_cols.items():
      all_types[ym] = all_types.get(ym, 0) + _num(r[c])
    vehicle_type = _text(r[3])
    if not is_passenger(vehicle_type):
      continue
    key = (vehicle_type, _text(r[4]) or 'Unclassified')
    for c, ym in month_cols.items():
      _sum_into(acc, key, ym, _num(r[c]))

  out = [
    {'vehicle_type': t, 'segment': s, 'year_month': ym, 'production': v}
    for (t, s, ym), v in acc.items() if v
  ]
  return ParseResult(out, {ym: v for ym, v in all_types.items() if v})


def _merge_tags(prev: str | None, new: str) -> str:
  """한 모델이 태그별 여러 줄이면 토큰을 합친다('EV/PHV' + 'ICE/EV' → 'EV/PHV/ICE')."""
  tokens = [t for t in (prev or '').split('/') if t]
  for t in new.split('/'):
    if t and t not in tokens:
      tokens.append(t)
  return '/'.join(tokens)


def export_sheet_name(sheetnames: list[str], year: int) -> str | None:
  """연도의 수출 시트 — 2025+ 는 「YYYY by Chinese Group」(「by Group」 은 글로벌 그룹 기준이라 안 쓴다)."""
  for name in (f'{year} by Chinese Group', str(year)):
    if name in sheetnames:
      return name
  return None


def parse_export_sheet(year: int, rows: list[tuple]) -> ParseResult:
  """Export Volume 시트 1개 → oem_china_export_month 행.

  헤더 행(「Chinese Group」 으로 시작 — 주석 줄 수가 시트마다 달라 위치를 찾는다):
    Chinese Group | Chinese Maker | Brand | Model | [EV] | Jan. … Dec. | [Adjusted value] | YYYY
  상위 칸은 병합 셀이라 빈칸이면 위 값을 잇는다. Model 이 빈 행은 소계(「… Total」)라 버린다.
  🔴 월별 합이 「Grand Total」 행과 다르면 ValueError — 병합·소계 규칙이 바뀐 것을 조용히 넘기지 않는다.
  """
  hi = next((i for i, r in enumerate(rows) if r and _text(r[0]) == 'Chinese Group'), None)
  if hi is None:
    raise ValueError(f'수출 {year} 시트에서 「Chinese Group」 헤더 행을 찾지 못했다')
  header = [_text(h) for h in rows[hi]]
  has_ev = header[4] == 'EV'
  month_cols = {}
  for c, h in enumerate(header):
    m = _MONTH_ABBR.get(h.rstrip('.').lower()[:3]) if h else None
    if m and len(h.rstrip('.')) <= 4:  # 'Jan.' · 'May' — 'Model' 같은 긴 이름은 거른다
      month_cols[c] = year * 100 + m
  if len(month_cols) != 12:
    raise ValueError(f'수출 {year} 시트의 월 열이 12개가 아니다: {header}')

  acc: dict[tuple, int] = {}
  tags: dict[tuple, str | None] = {}
  grand: dict[int, int] | None = None
  group = maker = brand = prev_model = None
  for r in rows[hi + 1:]:
    if not r or len(r) <= max(month_cols):
      continue
    first = _text(r[0])
    if first == 'Grand Total':
      grand = {ym: _num(r[c]) for c, ym in month_cols.items()}
      continue
    model = _text(r[3])
    if first.endswith(' Total') or (not model and (first or _text(r[1]) or _text(r[2]) or prev_model is None)):
      prev_model = None
      continue  # 소계 행(그룹 「… Total」 · 메이커 소계는 Chinese Maker 칸만 찬다)
    if not model:
      # 같은 모델이 EV 태그별로 줄을 나눠 모델 칸이 세로 병합된 줄(2025 실측: SAIC 765대가 이 모양)
      model = prev_model
    prev_model = model
    group = r[0] if _text(r[0]) else group
    maker = r[1] if _text(r[1]) else maker
    brand = r[2] if _text(r[2]) else brand
    key = (canonical_group(group, brand), _text(maker), canonical_brand(brand), model)
    tags[key] = _merge_tags(tags.get(key), _text(r[4])) if has_ev else None
    for c, ym in month_cols.items():
      v = _num(r[c])
      acc[key + (ym,)] = acc.get(key + (ym,), 0) + v

  if grand is None:
    raise ValueError(f'수출 {year} 시트에 Grand Total 행이 없다')
  parsed: dict[int, int] = {}
  for (*_, ym), v in acc.items():
    parsed[ym] = parsed.get(ym, 0) + v
  diff = {ym: (parsed.get(ym, 0), g) for ym, g in grand.items() if parsed.get(ym, 0) != g}
  if diff:
    raise ValueError(f'수출 {year} 월합 ≠ Grand Total: {diff}')

  out = [
    {'cn_group': g, 'maker': mk, 'brand': b, 'model': m, 'ev_tag': tags[(g, mk, b, m)],
     'year_month': ym, 'export_volume': v}
    for (g, mk, b, m, ym), v in acc.items() if v
  ]
  return ParseResult(out, {ym: v for ym, v in parsed.items() if v})
