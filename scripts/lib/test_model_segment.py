from lib.model_segment import parse_segment_rows


def test_동일_모델국가의_파워트레인이_배열로_합쳐진다():
  rows = [
    ('USA', 'Ford Group', 'Ford', 'Light Trucks', 'SUV-D', 'Explorer', 'HV'),
    ('USA', 'Ford Group', 'Ford', 'Light Trucks', 'SUV-D', 'Explorer', 'ICE'),
  ]
  out = parse_segment_rows(rows)
  assert len(out) == 1
  assert out[0]['model'] == 'Explorer'
  assert sorted(out[0]['powertrains']) == ['HV', 'ICE']


def test_NA_모델은_제외된다():
  rows = [('USA', 'G', 'B', 'Cars', 'C', 'N/A', 'ICE')]
  assert parse_segment_rows(rows) == []


def test_세그먼트가_비면_제외된다():
  rows = [('USA', 'G', 'B', 'Cars', None, 'Foo', 'ICE')]
  assert parse_segment_rows(rows) == []
