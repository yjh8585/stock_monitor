from datetime import datetime

import pytest

from lib.china_excel import (
  canonical_brand,
  canonical_group,
  export_sheet_name,
  is_passenger,
  normalize_powertrain,
  parse_export_sheet,
  parse_nev_sheet,
  parse_passenger_sheet,
  stale_keys,
)

MONTHS_2026 = [datetime(2026, m, 1) for m in range(1, 13)]


def _nev_header():
  return ['Maker/Brand', 'Group', 'Manufacturer', 'Type', 'Model', 'Details', 'HV/PHV/EV',
          *MONTHS_2026, 'Adjusted\nvalue', 2026]


def _months(*vals):
  return [*vals, *([None] * (12 - len(vals)))]


def test_파워트레인_정규화_복합토큰은_전동화_우선():
  assert normalize_powertrain(None) == 'ICE'
  assert normalize_powertrain('PHV') == 'PHEV'
  assert normalize_powertrain('MHV') == 'HV'
  assert normalize_powertrain('HV/EV') == 'EV'
  assert normalize_powertrain('MHV/PHV') == 'PHEV'
  assert normalize_powertrain('FCV') == 'FCEV'


def test_모르는_파워트레인_토큰은_조용히_넘기지_않는다():
  with pytest.raises(ValueError):
    normalize_powertrain('EREV')


def test_그룹명_맞추기와_na_대체():
  assert canonical_group('Chery Automobile', 'Chery') == 'Chery'
  assert canonical_group('Chery Group', 'Chery') == 'Chery'
  assert canonical_group('n.a.', 'Tesla') == 'Tesla'
  assert canonical_group('n.a.', 'n.a.') == 'n.a.'
  assert canonical_group('Leapmotor', 'Leapmotor') == 'Leapmotor'  # 표에 없으면 원문
  assert canonical_group('n.a.', 'Xiaopeng Motor') == 'XPeng'  # 대체된 브랜드명도 맞춘다
  assert canonical_group('n.a.', 212.0) == '212'  # .xls 숫자 브랜드


def test_NEV_트림은_합산되고_트럭은_빠지되_전차종합엔_든다():
  rows = [
    _nev_header(),
    [None, None, None, None, None, 'Engine displacement, etc.'],
    ['Audi', 'FAW (China FAW Group Corp.)', 'FAW-VW', 'Sedan/Hatchback', 'Audi A4', 'A4L 2.0T', None,
     *_months(100, 50), 0, 150],
    ['Audi', 'FAW (China FAW Group Corp.)', 'FAW-VW', 'Sedan/Hatchback', 'Audi A4', 'A4L 1.5T', '',
     *_months(10, '-'), 0, 10],
    ['Tesla', 'n.a.', 'Tesla Shanghai', 'SUV', 'Model Y', 'Model Y EV', 'EV', *_months(7), 0, 7],
    ['Foton', 'BAIC Group', 'Foton', 'Light trucks', 'N/A', '-', None, *_months(999), 0, 999],
  ]
  res = parse_nev_sheet(2026, rows)
  got = {(r['cn_group'], r['model'], r['powertrain'], r['year_month']): r['production'] for r in res.rows}
  assert got == {
    ('FAW', 'Audi A4', 'ICE', 202601): 110,
    ('FAW', 'Audi A4', 'ICE', 202602): 50,
    ('Tesla', 'Model Y', 'EV', 202601): 7,
  }
  assert res.all_types_total == {202601: 100 + 10 + 7 + 999, 202602: 50}


def test_NEV_2018시트의_NEW_꼬리표_헤더도_읽는다():
  header = _nev_header()
  header[6] = 'HV/PHV/EV\n[NEW]'
  header[7:19] = [datetime(2018, m, 1) for m in range(1, 13)]
  rows = [header, ['BYD', 'BYD Auto', 'BYD', 'SUV', 'Tang', 'Tang EV', 'EV', *_months(5), 0, 5]]
  assert [(r['cn_group'], r['powertrain'], r['year_month']) for r in parse_nev_sheet(2018, rows).rows] == [
    ('BYD', 'EV', 201801)
  ]


def test_NEV_헤더가_다르면_멈춘다():
  rows = [['Maker/Brand', 'Group', 'Manufacturer', 'Type', 'Model', 'Details', *MONTHS_2026]]
  with pytest.raises(ValueError):
    parse_nev_sheet(2026, rows)


def test_NEV_파워트레인_열이_있어도_앞_5열_이름이_다르면_멈춘다():
  header = _nev_header()
  header[1] = 'Chinese Group'
  with pytest.raises(ValueError, match='헤더'):
    parse_nev_sheet(2026, [header])


def test_브랜드는_시작연도_꼬리만_떼고_같은_브랜드로_합친다():
  assert canonical_brand('MG (2006-)') == 'MG'
  assert canonical_brand('Mercedes-Benz (2022-)') == 'Mercedes-Benz'
  assert canonical_brand('Yibin Kaiyi (2017-)') == 'Yibin Kaiyi'
  assert canonical_brand('Mercedes-Benz') == 'Mercedes-Benz'
  assert canonical_brand(212.0) == '212'
  rows = [
    _nev_header(),
    ['MG (2006-)', 'SAIC', 'SAIC Motor', 'SUV', 'MG ZS', 'a', None, *_months(3), 0, 3],
    ['MG', 'SAIC', 'SAIC Motor', 'SUV', 'MG ZS', 'b', None, *_months(4), 0, 4],
  ]
  assert [(r['maker_brand'], r['production']) for r in parse_nev_sheet(2026, rows).rows] == [('MG', 7)]


def test_차종은_승용_상용을_가르고_모르는_표기는_멈춘다():
  assert is_passenger('Mini Van') is True
  for commercial in ('Heavy trucks', 'Heavy Trucks (Chassis)', 'Small Buses', 'Semi Trailer', 'n.a.'):
    assert is_passenger(commercial) is False
  with pytest.raises(ValueError, match='차종'):
    is_passenger('Minivan')  # 승용 표기가 바뀐 것 — 상용으로 버리면 DB 에서 조용히 지워진다


def test_NEV_모르는_차종_표기가_나오면_멈춘다():
  rows = [_nev_header(), ['Wuling', 'SAIC', 'SGMW', 'Minivan', 'Hongguang', 'x', None, *_months(9), 0, 9]]
  with pytest.raises(ValueError, match='차종'):
    parse_nev_sheet(2026, rows)


def test_지울_키는_비율_안이면_돌려주고_넘으면_멈춘다():
  existing = {(i,) for i in range(100)}
  assert stale_keys(existing, existing - {(0,), (1,)}, 0.05) == {(0,), (1,)}
  assert stale_keys(set(), {(1,)}, 0.05) == set()  # 첫 적재
  with pytest.raises(RuntimeError, match='멈춘다'):
    stale_keys(existing, {(i,) for i in range(90)}, 0.05)
  assert len(stale_keys(existing, {(i,) for i in range(90)}, 0.2)) == 10  # 일부러 다시 적재할 때만 넓힌다


def test_승용차_엑셀은_세그먼트로_합산되고_트럭은_빠진다():
  header = ['Country', 'Group', 'Maker/Brand', 'Type', 'Segment', 'Model', 202601.0, 202602.0,
            'First Half(Jan.-Jun.)', 'Total']
  rows = [
    [None] * 9 + ['(units)'],
    header,
    ['China', 'Toyota Group', 'Toyota', 'SUV', 'SUV-C', 'RAV4', 10.0, '-', 10.0, 10.0],
    ['China', 'Toyota Group', 'Toyota', 'SUV', 'SUV-C', 'Frontlander', 5.0, 3.0, 8.0, 8.0],
    ['China', ' Small and Medium OEM', 'Foton', 'Light trucks', 'Unclassified', 'N/A', 100.0, 0.0, 100.0, 100.0],
  ]
  res = parse_passenger_sheet(rows)
  assert {(r['segment'], r['year_month']): r['production'] for r in res.rows} == {
    ('SUV-C', 202601): 15,
    ('SUV-C', 202602): 3,
  }
  assert res.all_types_total == {202601: 115, 202602: 3}


def test_승용차_엑셀_헤더가_다르면_멈춘다():
  header = ['Country', 'Group', 'Brand', 'Type', 'Segment', 'Model', 202601.0]
  with pytest.raises(ValueError, match='헤더'):
    parse_passenger_sheet([[None], header, ['China', 'g', 'b', 'SUV', 'SUV-C', 'm', 1.0]])


def test_승용차_엑셀에_다른_나라가_섞이면_멈춘다():
  header = ['Country', 'Group', 'Maker/Brand', 'Type', 'Segment', 'Model', 202601.0]
  rows = [[None], header, ['Japan', 'Toyota Group', 'Toyota', 'SUV', 'SUV-C', 'RAV4', 1.0]]
  with pytest.raises(ValueError):
    parse_passenger_sheet(rows)


EXPORT_HEADER = ['Chinese Group', 'Chinese Maker', 'Brand', 'Model', 'EV',
                 'Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.',
                 'Adjusted\nvalue', 2026]


def _export_rows(grand_jan):
  return [
    ['2026 Export volume in China by Chinese Group'],
    ['Starting in 2026, ...'],
    EXPORT_HEADER,
    ['Chery Group', 'Chery Automobile', 'Chery', 'Tiggo 7', 'PHV/ICE', *_months(30, 5), 0, 35],
    [None, None, None, '-', None, *_months(4), 0, 4],  # 병합 셀 빈칸 + 모델 미상
    [None, 'Chery Automobile', None, None, None, *_months(34, 5), 0, 39],  # 메이커 소계
    ['Chery Group Total', None, None, None, None, *_months(34, 5), 0, 39],
    ['n.a.', 'Tesla Motors (Shanghai)', 'Tesla', 'Model 3', 'EV', *_months(20), 0, 20],
    ['n.a. Total', None, None, None, None, *_months(20), 0, 20],
    ['Grand Total', None, None, None, None, *_months(grand_jan, 5), 0, 59],
  ]


def test_수출은_병합빈칸을_잇고_소계를_버리고_na는_브랜드로():
  res = parse_export_sheet(2026, _export_rows(54))
  got = {(r['cn_group'], r['brand'], r['model'], r['year_month']): (r['export_volume'], r['ev_tag']) for r in res.rows}
  assert got == {
    ('Chery', 'Chery', 'Tiggo 7', 202601): (30, 'PHV/ICE'),
    ('Chery', 'Chery', 'Tiggo 7', 202602): (5, 'PHV/ICE'),
    ('Chery', 'Chery', '-', 202601): (4, ''),
    ('Tesla', 'Tesla', 'Model 3', 202601): (20, 'EV'),
  }


def test_수출_모델칸이_세로병합된_태그별_줄은_위_모델로_합친다():
  rows = [
    EXPORT_HEADER,
    ['SAIC', 'SAIC Motor', 'MG', 'MG4', 'EV/PHV', *_months(10), 0, 10],
    [None, None, None, None, 'ICE/EV', *_months(5), 0, 5],  # 모델 칸 병합 — 소계가 아니다
    [None, 'SAIC Motor', None, None, None, *_months(15), 0, 15],  # 메이커 소계
    ['SAIC Total', None, None, None, None, *_months(15), 0, 15],
    ['Grand Total', None, None, None, None, *_months(15), 0, 15],
  ]
  res = parse_export_sheet(2026, rows)
  assert [(r['model'], r['export_volume'], r['ev_tag']) for r in res.rows] == [('MG4', 15, 'EV/PHV/ICE')]


def test_수출_브랜드도_시작연도_꼬리를_뗀다():
  rows = [
    EXPORT_HEADER,
    ['SERES Group', 'SERES', 'SERES (2022-)', 'AITO M7', 'PHV', *_months(6), 0, 6],
    ['Grand Total', None, None, None, None, *_months(6), 0, 6],
  ]
  assert [(r['cn_group'], r['brand']) for r in parse_export_sheet(2026, rows).rows] == [('SERES Group', 'SERES')]


def test_수출_월합이_Grand_Total과_다르면_멈춘다():
  with pytest.raises(ValueError):
    parse_export_sheet(2026, _export_rows(55))


def test_EV열이_없는_옛시트는_ev_tag가_None():
  header = [h for h in EXPORT_HEADER if h not in ('EV', 'Adjusted\nvalue')]
  rows = [
    ['2018 Export volume'],
    header,
    ['BYD Auto', 'BYD', 'BYD', 'Tang', *_months(3), 3],
    ['Grand Total', None, None, None, *_months(3), 3],
  ]
  res = parse_export_sheet(2018, rows)
  assert [(r['cn_group'], r['ev_tag'], r['export_volume']) for r in res.rows] == [('BYD', None, 3)]


def test_수출_시트이름은_중국모회사_기준을_고른다():
  names = ['2026 by Chinese Group', '2026 by Group', '2024']
  assert export_sheet_name(names, 2026) == '2026 by Chinese Group'
  assert export_sheet_name(names, 2024) == '2024'
  assert export_sheet_name(names, 2015) is None
