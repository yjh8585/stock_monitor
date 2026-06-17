"""현대차 분기 IR PDF에서 지역별 도매 판매량(천대) 추출 → hyundai_export_regions 적재.

수기 매핑: 21개 PDF(2021Q1~2026Q1)를 시각 검수하여 region별 당해(curr) 도매 추출.

자동 텍스트 추출이 PDF 레이아웃 변화·차트 그래픽으로 안정적이지 않아 수기 매핑 채택.
각 PDF에 대해 page 5 또는 6의 '글로벌 도·소매판매 현황' 차트를 시각 확인 → 값 + 검증 합 기록.
검증: 9 region 합과 PDF 글로벌 도매 합의 차이가 ±5천대 이내인지.

사용:
  python scripts/_collect_hyundai_quarterly_regions.py --year-from 2021 --year-to 2026
  python scripts/_collect_hyundai_quarterly_regions.py --quarter 1 --dry-run
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import WriteSession  # noqa: E402

# ────────────────────────────────────────────────────────────────────────────
# 상수
# ────────────────────────────────────────────────────────────────────────────
TABLE_NAME = 'hyundai_export_regions'
SOURCE = 'ir-quarterly'

GLOBAL_TOLERANCE = 10  # 글로벌 합 검증 허용 오차(천대) — 사사오입 다중 region 누적

# 수기 매핑 데이터.
# 키: year_period('YYYY-QN')
# 값: {
#   'wholesale_k_by_region': {region_name: curr_wholesale_k_units},
#   'global_wholesale_k': PDF에 표기된 글로벌 도매 합(천대),
#   'source_url': PDF 파일명,
# }
# region_name은 사용자 표준(한글, '아프리카&중동' 공백 없음).
# 2021~2024 옛 레이아웃 8 region (러시아 별도, 아태/아프리카 통합 '기타').
# 2025Q1 (1개)는 8 region (러시아 없음 + 아프리카&중동 없음, 아태 추가).
# 2025Q2~2026Q1 (4개)는 9 region (사용자 명세 풀 세트).
MANUAL: dict[str, dict] = {
  '2021-Q1': {
    'wholesale_k_by_region': {
      '유럽': 119, '중국': 94, '국내': 185, '미국': 224, '인도': 156,
      '러시아': 46, '중남미': 65, '기타': 108,
    },
    'global_wholesale_k': 1000,
  },
  '2021-Q2': {
    'wholesale_k_by_region': {
      '유럽': 148, '중국': 95, '국내': 201, '미국': 226, '인도': 114,
      '러시아': 57, '중남미': 78, '기타': 112,
    },
    'global_wholesale_k': 1031,
  },
  '2021-Q3': {
    'wholesale_k_by_region': {
      '유럽': 141, '중국': 66, '국내': 155, '미국': 187, '인도': 128,
      '러시아': 45, '중남미': 64, '기타': 114,
    },
    'global_wholesale_k': 899,
  },
  '2021-Q4': {
    'wholesale_k_by_region': {
      '유럽': 133, '중국': 98, '국내': 186, '미국': 188, '인도': 106,
      '러시아': 46, '중남미': 75, '기타': 129,
    },
    'global_wholesale_k': 961,
  },
  '2022-Q1': {
    'wholesale_k_by_region': {
      '유럽': 139, '중국': 58, '국내': 152, '미국': 208, '인도': 134,
      '러시아': 37, '중남미': 67, '기타': 107,
    },
    'global_wholesale_k': 903,
  },
  '2022-Q2': {
    'wholesale_k_by_region': {
      '유럽': 151, '중국': 37, '국내': 182, '미국': 241, '인도': 136,
      '러시아': 20, '중남미': 78, '기타': 131,
    },
    'global_wholesale_k': 976,
  },
  '2022-Q3': {
    'wholesale_k_by_region': {
      '유럽': 142, '중국': 84, '국내': 162, '미국': 244, '인도': 150,
      '러시아': 17, '중남미': 84, '기타': 142,
    },
    'global_wholesale_k': 1022,
  },
  '2022-Q4': {
    'wholesale_k_by_region': {
      '유럽': 137, '중국': 74, '국내': 192, '미국': 257, '인도': 135,
      '러시아': 17, '중남미': 80, '기타': 147,
    },
    'global_wholesale_k': 1039,
  },
  '2023-Q1': {
    'wholesale_k_by_region': {
      '유럽': 155, '중국': 60, '국내': 191, '미국': 258, '인도': 149,
      '러시아': 11, '중남미': 65, '기타': 133,
    },
    'global_wholesale_k': 1022,
  },
  '2023-Q2': {
    'wholesale_k_by_region': {
      '유럽': 166, '중국': 60, '국내': 206, '미국': 269, '인도': 149,
      '러시아': 13, '중남미': 68, '기타': 129,
    },
    'global_wholesale_k': 1060,
  },
  '2023-Q3': {
    'wholesale_k_by_region': {
      '유럽': 153, '중국': 56, '국내': 167, '미국': 275, '인도': 159,
      '러시아': 11, '중남미': 85, '기타': 140,
    },
    'global_wholesale_k': 1046,
  },
  '2023-Q4': {
    'wholesale_k_by_region': {
      '유럽': 163, '중국': 70, '국내': 199, '미국': 282, '인도': 148,
      '러시아': 12, '중남미': 85, '기타': 131,
    },
    'global_wholesale_k': 1090,
  },
  '2024-Q1': {
    'wholesale_k_by_region': {
      '유럽': 157, '중국': 48, '국내': 160, '미국': 287, '인도': 161,
      '러시아': 10, '중남미': 63, '기타': 120,
    },
    'global_wholesale_k': 1007,
  },
  '2024-Q2': {
    'wholesale_k_by_region': {
      '유럽': 157, '중국': 35, '국내': 186, '미국': 310, '인도': 150,
      '러시아': 11, '중남미': 79, '기타': 129,
    },
    'global_wholesale_k': 1057,
  },
  '2024-Q3': {
    'wholesale_k_by_region': {
      '유럽': 139, '중국': 22, '국내': 170, '미국': 300, '인도': 151,
      '러시아': 13, '중남미': 82, '기타': 135,
    },
    'global_wholesale_k': 1012,
  },
  '2024-Q4': {
    'wholesale_k_by_region': {
      '유럽': 156, '중국': 24, '국내': 189, '미국': 294, '인도': 147,
      '러시아': 19, '중남미': 91, '기타': 146,
    },
    'global_wholesale_k': 1066,
  },
  # 2025Q1: 새 레이아웃 8 region (아프리카&중동 미분리). 러시아 미표시.
  '2025-Q1': {
    'wholesale_k_by_region': {
      '미국': 243, '유럽': 151, '국내': 166, '인도': 154, '중국': 30,
      '중남미': 68, '아태': 49, '기타': 140,
    },
    'global_wholesale_k': 1007,
  },
  # 2025Q2 ~ 2026Q1: 9 region 풀 세트.
  '2025-Q2': {
    'wholesale_k_by_region': {
      '미국': 262, '유럽': 161, '국내': 189, '인도': 132, '중국': 31,
      '중남미': 85, '아태': 50, '아프리카&중동': 84, '기타': 72,
    },
    'global_wholesale_k': 1066,
  },
  '2025-Q3': {
    'wholesale_k_by_region': {
      '미국': 257, '유럽': 150, '국내': 181, '인도': 140, '중국': 32,
      '중남미': 83, '아태': 44, '아프리카&중동': 78, '기타': 73,
    },
    'global_wholesale_k': 1038,
  },
  '2025-Q4': {
    'wholesale_k_by_region': {
      '미국': 244, '유럽': 138, '국내': 177, '인도': 147, '중국': 38,
      '중남미': 92, '아태': 48, '아프리카&중동': 81, '기타': 68,
    },
    'global_wholesale_k': 1033,
  },
  '2026-Q1': {
    'wholesale_k_by_region': {
      '미국': 244, '유럽': 140, '국내': 159, '인도': 167, '중국': 27,
      '중남미': 74, '아태': 48, '아프리카&중동': 52, '기타': 66,
    },
    'global_wholesale_k': 976,
  },
}


def parse_yp(yp: str) -> tuple[int, int]:
  """`2024-Q3` → (2024, 3)."""
  y, q = yp.split('-Q')
  return int(y), int(q)


def validate_entry(yp: str, entry: dict) -> dict:
  """region 합 vs 글로벌 합 검증."""
  regions = entry['wholesale_k_by_region']
  region_sum = sum(regions.values())
  global_total = entry['global_wholesale_k']
  diff = region_sum - global_total
  status = 'ok' if abs(diff) <= GLOBAL_TOLERANCE else f'mismatch(diff={diff:+d})'
  return {
    'year_period': yp,
    'regions': regions,
    'region_sum': region_sum,
    'global_total': global_total,
    'diff': diff,
    'status': status,
    'n_regions': len(regions),
  }


def build_rows(yp: str, entry: dict, source_url: str) -> list[dict]:
  """upsert payload 빌드. 천대 → 대 단위로 환산."""
  rows = []
  for region_name, k_units in entry['wholesale_k_by_region'].items():
    rows.append({
      'period_type': 'quarter',
      'year_period': yp,
      'source': SOURCE,
      'region_name': region_name,
      'sales_units': int(k_units) * 1000,
      'source_url': source_url,
    })
  return rows


def main():
  ap = argparse.ArgumentParser(description='현대차 분기 IR PDF 지역별 도매 적재')
  ap.add_argument('--year-from', type=int, default=2021)
  ap.add_argument('--year-to', type=int, default=2026)
  ap.add_argument('--quarter', type=int, choices=[1, 2, 3, 4], default=None)
  ap.add_argument('--dry-run', action='store_true', help='DB upsert 생략')
  args = ap.parse_args()

  # 처리 대상 산출
  targets = []
  for yp in sorted(MANUAL):
    y, q = parse_yp(yp)
    if not (args.year_from <= y <= args.year_to):
      continue
    if args.quarter and q != args.quarter:
      continue
    targets.append(yp)
  logger.info(f'대상 분기 {len(targets)}개: {targets}')

  # 검증 + 행 빌드
  results = []
  all_rows = []
  for yp in targets:
    entry = MANUAL[yp]
    v = validate_entry(yp, entry)
    src_url = f'{yp.replace("-Q", "_q").lower()}.pdf'
    logger.info(
      f'  {yp}: regions={v["n_regions"]} sum={v["region_sum"]} '
      f'global={v["global_total"]} diff={v["diff"]:+d} status={v["status"]}'
    )
    results.append(v)
    if v['status'] == 'ok':
      all_rows.extend(build_rows(yp, entry, src_url))

  # 리포트
  ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
  report_path = Path(f'scripts/_hyundai_quarterly_regions_run_{ts}.json')
  report_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
  logger.info(f'리포트: {report_path}')

  if args.dry_run:
    logger.info(f'[dry-run] DB upsert 생략 ({len(all_rows)}행 대기)')
    return

  if not all_rows:
    logger.warning('적재할 행이 없다 (status=ok 분기 없음)')
    return

  with WriteSession() as w:
    w.table(TABLE_NAME).upsert(
      all_rows,
      on_conflict='period_type,year_period,source,region_name',
    ).execute()
  logger.info(f'upsert 완료: {len(all_rows)}행 → {TABLE_NAME}')


if __name__ == '__main__':
  main()
