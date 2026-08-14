"""NHTSA(미국 도로교통안전국) 공개 API — 차종별 리콜·소비자 불만.

무료·무인증. 미국 등록 차량 한정이라 미국에서 팔지 않는 차종(avante_china)은 제외한다.
모델연도가 아직 등록되지 않으면 Count 0 또는 HTTP 400 이 오므로 최신 연도부터 폴백한다.

🔴 모델명은 **접두 매칭**으로 푼다 (2026-08-13 실측으로 전환).
   NHTSA 표기에는 파생형 접미사가 붙는다: 'civic sedan' · 'sienna hybrid hev' ·
   'f-150 (super crew) gas' · 'model x bev' · 'niro hev'. 정확 일치로 조회하면 결과가
   **0건으로 돌아오고 이는 "리콜 없는 안전한 차"로 오독된다** — 조용한 오류다.
   실측으로 드러난 기존 매핑의 실제 누락:
     - ram_truck: ['1500','2500','3500'] → 실제 이름이 'ram 1500 crew cab' 이라 **주력 1500 이
       통째로 빠지고 '3500' 만** 잡히고 있었다.
     - niro: 'niro' → 실제 'niro hev' 라 최신 연도에서 매번 폴백하고 있었다.
     - porsche_911: '911' → 파생형('911 carrera gts')만 있어 2024년형까지 밀려났다.

   그래서 products 끝점으로 그 make 의 **실제 모델 목록**을 받아 접두로 매칭한다.
   패턴이 하나도 안 잡히면 경고를 남긴다(0건과 매핑 오류를 구분하기 위해).

⚠️ 접두 매칭은 과잉 매칭을 부른다 — 'corolla' 는 'corolla cross' 까지 잡는다(둘은 다른 차종이고
   경쟁군에 각각 따로 있다). 그래서 매핑 3번째 원소로 **제외 접두**를 둔다.
"""
import time

import requests
from loguru import logger

RECALL_URL = 'https://api.nhtsa.gov/recalls/recallsByVehicle'
COMPLAINT_URL = 'https://api.nhtsa.gov/complaints/complaintsByVehicle'
MODELS_URL = 'https://api.nhtsa.gov/products/vehicle/models'
TIMEOUT = 30

# 한 차종이 파생형을 아주 많이 갖는 경우(F-150 계열 8종)까지 전부 조회하면 호출 수가 폭증한다.
# 판매 비중이 큰 앞쪽 파생형만으로도 리콜 규모 비교에는 충분하다.
MAX_VARIANTS = 6

# (make, 접두 패턴, 제외 접두). 접두 매칭이므로 파생형이 자동으로 따라온다.
NHTSA_MODEL_MAP: dict[str, tuple[str, list[str], list[str]]] = {
  'grand_cherokee': ('jeep', ['grand cherokee'], []),
  'ram_truck': ('ram', ['ram 1500', 'ram 2500', '3500'], []),
  'pacifica': ('chrysler', ['pacifica'], []),
  'rivian_r1': ('rivian', ['r1t', 'r1s'], []),
  'atlas': ('volkswagen', ['atlas'], []),
  'porsche_911': ('porsche', ['911'], []),
  'seltos': ('kia', ['seltos'], []),
  'avante_ex_china': ('hyundai', ['elantra'], []),
  'niro': ('kia', ['niro'], []),
  # avante_china 는 미국 미판매 → 제외
}

# 경쟁 차종 매핑 — 키는 MarkLines 모델명(oem_competitor_set.competitor_models 와 같은 표기).
# 2026-08-13 products 끝점으로 전수 검증했다(F-Type 만 실패 → Jaguar 가 NHTSA 목록에 없어 제외).
NHTSA_COMPETITOR_MAP: dict[str, tuple[str, list[str], list[str]]] = {
  # 3열 SUV
  'Explorer': ('ford', ['explorer'], []),
  'Traverse': ('chevrolet', ['traverse'], []),
  'Grand Highlander': ('toyota', ['grand highlander'], []),
  'Telluride': ('kia', ['telluride'], []),
  'Palisade': ('hyundai', ['palisade'], []),
  'Honda Pilot': ('honda', ['pilot'], []),
  'Highlander': ('toyota', ['highlander'], []),
  'Grand Cherokee (Jeep (2009-))': ('jeep', ['grand cherokee'], []),
  # 준중형 세단 — 'corolla' 는 'corolla cross'(별개 차종)를 잡으므로 제외 지정
  'Civic': ('honda', ['civic'], []),
  'Corolla': ('toyota', ['corolla'], ['corolla cross']),
  'Sentra': ('nissan', ['sentra'], []),
  'Jetta': ('volkswagen', ['jetta'], []),
  'K4': ('kia', ['k4'], []),
  # SUV-C
  'HR-V': ('honda', ['hr-v'], []),
  'Kona': ('hyundai', ['kona'], []),
  'Corolla Cross': ('toyota', ['corolla cross'], []),
  'Crosstrek': ('subaru', ['crosstrek'], []),
  'Trailblazer': ('chevrolet', ['trailblazer'], []),
  # 미니밴
  'Odyssey': ('honda', ['odyssey'], []),
  'Sienna': ('toyota', ['sienna'], []),
  'Carnival (Sedona)': ('kia', ['carnival'], []),
  # 풀사이즈 픽업 — EV 파생형은 별개 차종이라 제외
  'Ford F-Series': ('ford', ['f-150', 'f-250', 'f-350'], []),
  'Silverado': ('chevrolet', ['silverado'], ['silverado ev']),
  'GMC Sierra': ('gmc', ['sierra'], ['sierra ev']),
  'Tundra': ('toyota', ['tundra'], []),
  'Nissan Titan': ('nissan', ['titan'], []),
  # 프리미엄 전기 — 'hummer ev' 는 픽업, 'hummer ev suv' 는 SUV 라 서로 제외한다
  'Model X': ('tesla', ['model x'], []),
  'Cybertruck': ('tesla', ['cybertruck'], []),
  'Hummer SUV': ('gmc', ['hummer ev suv'], []),
  'Hummer Pickup': ('gmc', ['hummer ev'], ['hummer ev suv']),
  'Lucid Air': ('lucid', ['air'], []),
  'EV9': ('kia', ['ev9'], []),
  'IONIQ 5': ('hyundai', ['ioniq 5'], []),
  # 스포츠카 — F-Type(Jaguar)은 NHTSA 목록에 없어 미등록
  'Corvette': ('chevrolet', ['corvette'], []),
  'Boxster/Cayman': ('porsche', ['718', 'cayman', 'boxster'], []),
  'Supra': ('toyota', ['supra'], []),
  'Nissan Z': ('nissan', ['z'], []),
}

_models_cache: dict[tuple[str, int, str], list[str]] = {}


def summarize_recalls(results: list[dict]) -> dict:
  """리콜 목록 → {count, top_components:[(부품군, 건수)], latest:[요약 2건]}"""
  counts: dict[str, int] = {}
  for r in results or []:
    comp = (r.get('Component') or '기타').strip()
    counts[comp] = counts.get(comp, 0) + 1
  top = sorted(counts.items(), key=lambda kv: -kv[1])[:3]
  latest = [(r.get('Summary') or '')[:180] for r in (results or [])[:2]]
  return {'count': len(results or []), 'top_components': top, 'latest': latest}


def summarize_complaint_components(results: list[dict]) -> list[tuple[str, int]]:
  """불만 목록 → 부품군 상위 3개 [(부품군, 건수)].

  화면이 "무슨 불만인가"를 펼쳐 보이려면 건수만으로는 부족하다(사용자 지시 2026-08-14).

  ⚠️ 리콜과 필드 이름·형식이 다르다. 리콜은 `Component` 한 개지만 불만은 소문자 `components` 이고
  'ELECTRICAL SYSTEM,ENGINE' 처럼 **콤마로 여러 개가 붙어** 온다 — 통째로 세면 조합마다 다른
  항목이 돼 상위 3개가 의미를 잃는다. 그래서 쪼개서 각각 센다.
  """
  counts: dict[str, int] = {}
  for r in results or []:
    raw = r.get('components') or r.get('Component') or ''
    parts = [p.strip() for p in str(raw).split(',') if p.strip()] or ['기타']
    for part in parts:
      counts[part] = counts.get(part, 0) + 1
  return sorted(counts.items(), key=lambda kv: -kv[1])[:3]


def _get(url: str, make: str, model: str, year: int) -> list[dict] | None:
  try:
    r = requests.get(url, params={'make': make, 'model': model, 'modelYear': year}, timeout=TIMEOUT)
  except requests.RequestException as e:
    logger.warning(f'NHTSA 호출 실패 {make}/{model}/{year} — {e}')
    return None
  if r.status_code != 200:
    return None
  try:
    data = r.json()
  except (ValueError, requests.exceptions.JSONDecodeError) as e:
    logger.warning(f'NHTSA JSON 파싱 실패 {make}/{model}/{year} — {e}')
    return None
  return data.get('results') or []


def _list_models(make: str, year: int, issue_type: str) -> list[str]:
  """그 make·연도·이슈종류의 실제 모델명 목록(소문자).

  ⚠️ 리콜(`r`)과 불만(`c`)의 모델 목록이 서로 다르다 — 실측: Ram 2026 리콜 목록에는
  'ram 1500 crew cab' 이 있지만 불만 끝점에서는 그 이름이 400 을 돌려준다. 목록을 하나로
  쓰면 그 파생형의 불만 건수가 조용히 0 이 된다.
  """
  key = (make, year, issue_type)
  if key in _models_cache:
    return _models_cache[key]
  names: list[str] = []
  # 빈 본문이 간헐적으로 온다(연속 호출 시). 한 번은 다시 시도한다 — 목록이 비면 그 차종의
  # 건수가 통째로 0 이 되고, 0 은 "이슈 없는 차"로 오독된다.
  for attempt in (1, 2):
    try:
      r = requests.get(MODELS_URL, params={'modelYear': year, 'make': make,
                                           'issueType': issue_type}, timeout=TIMEOUT)
      names = sorted({str(m.get('model', '')).strip().lower()
                      for m in (r.json().get('results') or [])})
      break
    except (requests.RequestException, ValueError) as e:
      if attempt == 2:
        logger.warning(f'NHTSA 모델 목록 조회 실패 {make}/{year}/{issue_type} — {e}')
      else:
        time.sleep(1.0)
  _models_cache[key] = names
  return names


def _matches(name: str, prefixes: list[str]) -> bool:
  return any(name == p or name.startswith(p + ' ') for p in prefixes)


def _resolve(make: str, patterns: list[str], exclude: list[str], year: int,
             issue_type: str = 'r') -> list[str]:
  """그 연도의 실제 모델명 중 패턴에 접두 매칭되는 것들. 제외 접두에 걸리면 뺀다."""
  names = _list_models(make, year, issue_type)
  if not names:
    return []
  hit = [n for n in names if _matches(n, patterns) and not _matches(n, exclude)]
  return sorted(hit)[:MAX_VARIANTS]


def _fetch(entry: tuple[str, list[str], list[str]], years: list[int], label: str,
           *, detail: bool) -> dict | None:
  """매핑 1건의 리콜·불만. detail=False 면 건수만(경쟁 차종용, 페이로드 절약)."""
  make, patterns, exclude = entry
  for year in years:
    variants = _resolve(make, patterns, exclude, year, 'r')
    if not variants:
      continue
    all_recalls: list[dict] = []
    for model in variants:
      recalls = _get(RECALL_URL, make, model, year)
      if recalls:
        all_recalls.extend(recalls)
    # 불만은 목록이 따로라 같은 연도에서 다시 푼다(리콜 이름을 그대로 쓰면 400 이 난다).
    # 불만 목록을 못 받으면 리콜 이름으로라도 시도한다 — 아예 건너뛰면 0 건으로 남는다.
    total_complaints, any_ok = 0, False
    all_complaints: list[dict] = []
    for model in (_resolve(make, patterns, exclude, year, 'c') or variants):
      complaints = _get(COMPLAINT_URL, make, model, year)
      if complaints is None:
        logger.warning(f'NHTSA 불만 조회 실패 {make}/{model}/{year}')
      else:
        any_ok = True
        total_complaints += len(complaints)
        if detail:  # 원문은 대상 차종만 들고 있는다 — 경쟁까지 모으면 페이로드가 수백 배로 뛴다
          all_complaints.extend(complaints)
    # 리콜이 0건이어도 매칭된 파생형이 있으면 유효한 결과다(실제로 리콜이 없는 차종).
    summary = summarize_recalls(all_recalls) if detail else {'count': len(all_recalls)}
    out = {
      'model_year': year,
      'variants': variants,
      'recalls': summary,
      # 한 건도 성공 못 했으면 None(=알 수 없음). 0 으로 두면 "불만 없는 차"로 오독된다.
      'complaint_count': total_complaints if any_ok else None,
    }
    if detail and any_ok:
      out['complaint_components'] = summarize_complaint_components(all_complaints)
    return out
  # 어느 연도에서도 패턴이 안 잡혔다 = 매핑이 깨졌을 가능성. 0건과 반드시 구분해 남긴다.
  logger.warning(f'NHTSA 모델명 매칭 실패 — {label} ({make}/{patterns}, 연도 {years})')
  return None


def fetch_safety(model_key: str, *, years: list[int]) -> dict | None:
  """대상 차종의 리콜·불만 요약(부품군·최근 리콜 요약 포함). 매핑이 없으면 None."""
  entry = NHTSA_MODEL_MAP.get(model_key)
  if not entry:
    return None
  return _fetch(entry, years, model_key, detail=True)


def fetch_competitor_safety(model_name: str, *, years: list[int]) -> dict | None:
  """경쟁 차종의 리콜·불만 **건수**. 매핑이 없으면 None(화면이 '데이터 없음' 처리)."""
  entry = NHTSA_COMPETITOR_MAP.get(model_name)
  if not entry:
    return None
  return _fetch(entry, years, model_name, detail=False)
