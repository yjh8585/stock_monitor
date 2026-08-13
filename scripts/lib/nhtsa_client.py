"""NHTSA(미국 도로교통안전국) 공개 API — 차종별 리콜·소비자 불만.

무료·무인증. 미국 등록 차량 한정이라 미국에서 팔지 않는 차종(avante_china)은 제외한다.
모델연도가 아직 등록되지 않으면 Count 0 또는 HTTP 400 이 오므로 최신 연도부터 폴백한다
(실측: 2026 Jeep Grand Cherokee 는 리콜 3건·불만 11건, 2026 Kia Seltos 는 0건).
"""
import requests
from loguru import logger

RECALL_URL = 'https://api.nhtsa.gov/recalls/recallsByVehicle'
COMPLAINT_URL = 'https://api.nhtsa.gov/complaints/complaintsByVehicle'
TIMEOUT = 30

# model_key → (NHTSA make, NHTSA model). MarkLines 표기와 다르므로 수동 매핑한다.
NHTSA_MODEL_MAP: dict[str, tuple[str, str]] = {
  'grand_cherokee': ('jeep', 'grand cherokee'),
  'ram_truck': ('ram', '1500'),
  'pacifica': ('chrysler', 'pacifica'),
  'rivian_r1': ('rivian', 'r1s'),
  'atlas': ('volkswagen', 'atlas'),
  'porsche_911': ('porsche', '911'),
  'seltos': ('kia', 'seltos'),
  'avante_ex_china': ('hyundai', 'elantra'),
  'niro': ('kia', 'niro'),
  # avante_china 는 미국 미판매 → 제외
}


def summarize_recalls(results: list[dict]) -> dict:
  """리콜 목록 → {count, top_components:[(부품군, 건수)], latest:[요약 2건]}"""
  counts: dict[str, int] = {}
  for r in results or []:
    comp = (r.get('Component') or '기타').strip()
    counts[comp] = counts.get(comp, 0) + 1
  top = sorted(counts.items(), key=lambda kv: -kv[1])[:3]
  latest = [(r.get('Summary') or '')[:180] for r in (results or [])[:2]]
  return {'count': len(results or []), 'top_components': top, 'latest': latest}


def _get(url: str, make: str, model: str, year: int) -> list[dict] | None:
  try:
    r = requests.get(url, params={'make': make, 'model': model, 'modelYear': year}, timeout=TIMEOUT)
  except requests.RequestException as e:
    logger.warning(f'NHTSA 호출 실패 {make}/{model}/{year} — {e}')
    return None
  if r.status_code != 200:
    return None
  data = r.json()
  return data.get('results') or []


def fetch_safety(model_key: str, *, years: list[int]) -> dict | None:
  """model_key 의 리콜·불만 요약. 매핑이 없거나 전 연도가 비면 None."""
  mapped = NHTSA_MODEL_MAP.get(model_key)
  if not mapped:
    return None
  make, model = mapped
  for year in years:
    recalls = _get(RECALL_URL, make, model, year)
    if recalls:
      complaints = _get(COMPLAINT_URL, make, model, year) or []
      return {
        'model_year': year,
        'recalls': summarize_recalls(recalls),
        'complaint_count': len(complaints),
      }
  logger.info(f'NHTSA 데이터 없음 — {model_key} ({years})')
  return None
