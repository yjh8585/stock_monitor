"""sourcing_parse 순수 함수 시험 — 실제 경쟁사·품목 이름을 쓰지 않는다(공개 레포)."""
from lib.sourcing_parse import parse_detail, parse_employees, region_of, UNKNOWN_COUNTRIES

DETAIL = {
  'profile': {
    'id': 4242,
    'supplier_rand_code': '000000000000777',
    'i18n_suppliers': [{
      'name': 'Acme Widgets Co., Ltd.',
      'establish': '1971',
      'sales': 'THB 42 million (FY ended Jun. 30, 2024)',
      'employee': '1,234 employees (As of Jun. 30, 2024)',
      'address': '42 Example Street, Exampleville, Thailand',
      'homepage': 'https://acme.example',
      'i18n_supplier_remarks': [{'remark': '-Hooli Group company'}],
    }],
    'mst_nation': {'name': 'Thailand'},
    'quality_assurances': [{'name': 'IATF16949'}, {'name': 'ISO9001'}],
  },
  'products': {
    'Engine parts': [{'s_name': 'Widget'}],
    'Process type (example)': [{'s_name': 'Die casting'}],
  },
  'parts_comments': {'en': [{'parts': 'Widget housings'}]},
  'delivers': {
    'oem': [{'name': 'Initech Motors'}],
    'supplier': [{'name': 'Globex'}, {'name': 'Globex Widgets Asia'}],
  },
}


def test_region_of():
  assert region_of('Thailand') == '동남아'
  assert region_of('Mexico') == '북미'
  assert region_of('Korea') == '한국'
  assert region_of('Germany') == '유럽'
  assert region_of('India') == '인도'
  assert region_of('Japan') == '일본'
  assert region_of('China') == '중국'
  assert region_of(None) == '기타'


def test_region_of_unknown_is_recorded():
  UNKNOWN_COUNTRIES.clear()
  assert region_of('Atlantis') == '기타'
  assert 'Atlantis' in UNKNOWN_COUNTRIES


def test_parse_employees():
  assert parse_employees('1,234 employees (As of Jun. 30, 2024)') == 1234
  assert parse_employees('Approx. 120') == 120
  assert parse_employees(None) is None
  assert parse_employees('N/A') is None


def test_parse_detail():
  row = parse_detail(DETAIL, '000000000000777')
  assert row['ml_supplier_id'] == 4242
  assert row['ml_rand_code'] == '000000000000777'
  assert row['name'] == 'Acme Widgets Co., Ltd.'
  assert row['country'] == 'Thailand' and row['region'] == '동남아'
  assert row['employees'] == 1234
  assert row['certifications'] == ['IATF16949', 'ISO9001']
  assert row['product_categories'] == ['Widget']
  assert row['processes'] == ['Die casting']
  assert row['parts_comments'] == ['Widget housings']
  assert row['delivers_oem'] == ['Initech Motors']
  assert row['delivers_supplier'] == ['Globex', 'Globex Widgets Asia']
  assert row['remarks'] == ['-Hooli Group company']
  assert row['source'] == 'marklines'
  assert row['source_url'] == 'https://www.marklines.com/en/supplier_db/000000000000777/'
  assert 'fetched_at' not in row
