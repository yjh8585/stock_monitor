"""MarkLines 판매 엑셀의 (Country, Type, Segment, Model, PowerTrain) → 매핑 행 변환.

엑셀 헤더는 sync_oem_excel.py 의 EXPECTED_HEADER_PREFIX 와 동일하다:
  ('Country', 'Group', 'Maker/Brand', 'Type', 'Segment', 'Model', 'PowerTrain')
'N/A' 모델은 MarkLines 미분류 행이라 각국 판매 1위로 잡히므로 반드시 제외한다.
"""

EXCLUDED_MODELS = {'N/A', 'N/A (Trucks)'}


def parse_segment_rows(rows) -> list[dict]:
  """엑셀 메타 7열 튜플 목록 → oem_model_segment upsert 행 목록 (멱등·중복 병합)."""
  acc: dict[tuple[str, str], dict] = {}
  for row in rows:
    if not row or len(row) < 7:
      continue
    country, _group, _brand, vehicle_type, segment, model, powertrain = row[:7]
    if not model or not country or not segment or not vehicle_type:
      continue
    model = str(model).strip()
    if model in EXCLUDED_MODELS or model.startswith('N/A'):
      continue
    key = (model, str(country).strip())
    entry = acc.setdefault(key, {
      'model': key[0],
      'country': key[1],
      'vehicle_type': str(vehicle_type).strip(),
      'segment': str(segment).strip(),
      'powertrains': set(),
    })
    if powertrain and str(powertrain).strip() not in ('', 'N/A'):
      entry['powertrains'].add(str(powertrain).strip())
  return [
    {**v, 'powertrains': sorted(v['powertrains'])}
    for v in acc.values()
  ]
