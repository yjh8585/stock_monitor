"""Batch A 홈페이지 URL HEAD 검증. 200/30x 외 응답은 NULL로 되돌림.

batch A: 방금 채운 40개 회사 (customers_updated_at 무관, homepage_url SET 시점 기준).
실패 회사 목록만 출력 — 사용자 결정 후 NULL 처리.
"""
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import requests
from dotenv import load_dotenv
from loguru import logger

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

sys.path.insert(0, str(ROOT))
from lib.db import get_client  # noqa: E402

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}


def check(url: str) -> tuple[str, int | str]:
  try:
    r = requests.head(url, headers=HEADERS, timeout=10, allow_redirects=True)
    if r.status_code >= 400:
      # 일부 사이트는 HEAD 거부 → GET 재시도
      r = requests.get(url, headers=HEADERS, timeout=10, allow_redirects=True, stream=True)
      r.close()
    return url, r.status_code
  except Exception as e:
    return url, f'ERR: {type(e).__name__}'


def main() -> int:
  client = get_client()
  BATCH_A_IDS = [
    'f3bc4c0d-9f96-45d2-8621-fe511d80b2c3','2caf2841-793d-4e56-9972-c76a71332741',
    '06550240-85c4-4ed4-a808-94722c56ee38','2631fc2e-47c5-4612-a15c-7920e7ce3911',
    'ea664430-e528-4afe-9c74-a940c095a9b2','18a3f307-812b-4b1f-b4a9-fab46bee7c39',
    '50773835-8dfe-4405-ae1e-554e556ee9cd','e7fd01b0-7084-4442-8991-d17677f2755b',
    '62a51282-0dd4-4455-9869-1dd7dc48a7b6','0faaa461-33cd-41b3-9440-dd33bbd250cf',
    'cc9bbd9b-3597-4a87-99ac-6cdeb6983f23','ced321c6-0b4f-444c-971a-b0d77fde25c6',
    '06b7d16f-60f8-48bf-83f0-d8ce42767b7d','e37f793f-e32d-4cce-a635-ff44350f5c7e',
    '2e142cbc-5718-4677-a2bf-e9947a17df36','70f01860-9d27-4108-80d7-96eedfc56fb7',
    'ea4ee668-4f70-4f49-b651-9b02a97cd698','c486f14b-656d-4af1-894a-4e1cf975536b',
    '35a42626-b4f3-4860-a552-089a74bb78a5','8d109ea4-4895-4db9-aa8c-2c562ff8338c',
    '676c08db-9098-4ee3-a112-17bad352a10a','a2c50ca7-98c2-43a2-87c1-f6a8d81929ad',
    '96f60949-7482-487c-8826-44b245992478','e58393fe-0f70-4db9-92f1-df5376a1948c',
    '87aa68af-2dc2-4887-ab89-b61a6e8fe94e','714e27fb-9e78-4233-8ebb-8a895c0eefbb',
    'e03d6d6f-0f2c-40f2-9d70-f4c25214452d','90f80a28-8053-4aa6-97b0-f22380a29593',
    '33785863-d63d-4161-9c9c-eef600c6d152','539ab2d7-5955-4e2b-bacd-8817e3cd51b9',
    'e9696f0f-ae8a-4d23-adcd-dba42006288d','46672b8d-5242-46f9-a801-6559e82c6410',
    '46ddd1a5-03d0-4660-9ac8-29be9fe0ffa1','c1209e94-98fd-4f6f-92b0-94c3485dda75',
    '6e4fd103-f621-4a3e-9a40-c412255a8d5b','aa906f3e-673b-4859-8a3a-f48f1899843d',
    '7bc015a0-6e63-4e1a-bd33-0f25ca791f92','a3b1044e-9c63-40a5-94ef-8d5fcb670207',
    'a998c4d0-f394-4712-becd-2bac34549909','1f8c337e-13dc-42db-8fd9-aea66a6e5777',
  ]
  resp = client.table('companies').select('id,name_kr,homepage_url').in_('id', BATCH_A_IDS).execute()
  rows = [r for r in (resp.data or []) if r.get('homepage_url')]
  logger.info(f'검증 대상 {len(rows)}개')

  url_to_company: dict[str, tuple[str, str]] = {r['homepage_url']: (r['id'], r['name_kr']) for r in rows}
  failed: list[tuple[str, str, str | int]] = []
  ok = 0

  with ThreadPoolExecutor(max_workers=8) as ex:
    for url, status in ex.map(check, url_to_company.keys()):
      cid, name = url_to_company[url]
      if isinstance(status, int) and 200 <= status < 400:
        ok += 1
      else:
        failed.append((name, url, status))

  logger.info(f'\n=== 결과 ===')
  logger.info(f'  OK: {ok}/{len(rows)}')
  logger.info(f'  실패: {len(failed)}/{len(rows)}')
  for name, url, status in failed:
    logger.warning(f'  ✗ {name} ({status}): {url}')

  return 0


if __name__ == '__main__':
  sys.exit(main())
