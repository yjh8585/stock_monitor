#!/usr/bin/env python3
"""
companies.products 영어/약어 제품명을 한글로 정규화한다.
- 콤마(,)/&/슬래시(/)로 구분된 항목은 개별 제품으로 분할
- 영어 → 한글 매핑 적용 (TRANSLATION 사전)
- 약어로만 통하는 것(ECU/TCU/AVN/EMS/ADAS/HVAC 등)은 그대로 유지
- 동일 제품은 표기 통일
"""
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

from lib.db import get_client

# ──────────────────────────────────────────────
# 영어/약어 → 한글 매핑 (전체 토큰 단위 매칭)
# 키는 대문자/소문자 무관(상단 정규화 후 비교)
# ──────────────────────────────────────────────
TRANSLATION: dict[str, str] = {
  # 시트/내장
  'SEAT': '시트',
  'SEAT BELT': '시트벨트',
  'SEAT COVER': '시트 커버',
  'SEAT CLOTH': '시트 원단',
  'SEAT HEATER': '시트 히터',
  'SEAT(BUS)': '버스용 시트',
  'SEAT(TRK)': '트럭용 시트',
  'ARM REST': '암레스트',
  'CONSOLE': '콘솔',
  'CONSOL': '콘솔',
  'GLOVE BOX': '글로브박스',
  'CRASH PAD': '크래시 패드',
  'CENTER PANEL': '센터 패널',
  'STORAGE BOX': '스토리지 박스',
  'STORAGE BOX ASM CTR': '센터 콘솔 스토리지 박스',

  # 도어/외장
  'DOOR': '도어',
  'DOOR(FRT/RR)': '전/후 도어',
  'DOOR HANDLE': '도어 핸들',
  'DOOR LATCH': '도어 래치',
  'DOOR TRIM': '도어 트림',
  'DOOR FRAME': '도어 프레임',
  'DOOR BELT': '도어 벨트',
  'DOOR MOULDING': '도어 몰딩',
  'OUT SIDE HANDLE': '아웃사이드 핸들',
  'IMPACT BEAM': '임팩트 빔',
  'DR MODULE': '도어 모듈',
  'KEY SET': '키 세트',
  'WINDOW REGULATOR': '윈도우 레귤레이터',
  'POWER WINDOW MOTOR': '파워 윈도우 모터',
  'BUMPER': '범퍼',
  'BUMPER MODULE': '범퍼 모듈',
  'FRONT DECK': '프론트 데크',
  'FRONT END MODULE': '프론트 엔드 모듈',
  'REAR DECK': '리어 데크',
  'REAR DECK(1TON)': '1톤 리어 데크',
  'COWL': '카울',
  'DASH PANEL': '대시 패널',
  'LOWER DASH': '로어 대시',
  'PILLAR TRIM': '필러 트림',
  'PACKAGE TRAY': '패키지 트레이',
  'RADIATOR GRILLE': '라디에이터 그릴',
  'EMBLEM': '엠블럼',
  'WHEEL GUARD': '휠 가드',
  'SIDE PROTECTOR': '사이드 프로텍터',
  'UNDER COVER': '언더 커버',
  'ENGINE COVER': '엔진 커버',
  'MAT': '매트',
  'FLOOR MAT': '플로어 매트',
  'FLOOR CARPET': '플로어 카펫',
  'SUN VISOR': '선바이저',
  'HEAD LINING MODULE': '헤드라이닝 모듈',
  'DECO TAPE': '데코 테이프',
  'MOULDING': '몰딩',

  # 차체/샤시
  'CHASSIS FRAME': '샤시 프레임',
  'SIDE MEMBER': '사이드 멤버',
  'CROSS MEMBER': '크로스 멤버',
  'FRT APRON': '프론트 에이프런',
  'LADDER FRAME': '래더 프레임',
  'ROOF RACK': '루프 랙',

  # 미러/카메라/조명
  'REAR VIEW MIRROR': '사이드미러',
  'CAMERA': '카메라',
  'FRONT/REAR CAMERA': '전/후방 카메라',
  'AUTO LAMP': '자동차 램프',
  'LAMP': '램프',

  # 엔진/파워트레인
  'CYLINDER BLOCK': '실린더 블록',
  'CYLINDER HEAD': '실린더 헤드',
  'CYLINDER HEAD GASKET': '실린더 헤드 가스켓',
  'INTAKE MANIFOLD': '흡기 매니폴드',
  'INTAKE MANIFOLD(PLASTIC)': '플라스틱 흡기 매니폴드',
  'AIR INTAKE': '에어 인테이크',
  'AIR CLEANER': '에어 클리너',
  'CANISTER': '캐니스터',
  'FUEL FILTER': '연료필터',
  'FUEL PUMP': '연료 펌프',
  'FUEL TANK': '연료 탱크',
  'PLASTIC FUEL TANK': '플라스틱 연료 탱크',
  'PISTON': '피스톤',
  'PISTON RING': '피스톤 링',
  'PISTON PIN': '피스톤 핀',
  'CONNECTING ROD': '커넥팅 로드',
  'METAL BEARING': '메탈 베어링',
  'CAM CAP': '캠 캡',
  'BUSHING': '부싱',
  'ROCKER ARM': '로커 암',
  'VALVE BODY': '밸브 바디',
  'TIMING BELT': '타이밍 벨트',
  'TIMING CHAIN COVER': '타이밍 체인 커버',
  'CHAIN SYSTEM': '체인 시스템',
  'AUTO TENSIONER': '오토 텐셔너',
  'V-BELT': 'V 벨트',
  'W/STRIP': '웨더 스트립',
  'OIL PUMP': '오일 펌프',
  'OIL SEAL': '오일씰',
  'OIL COOLER': '오일 쿨러',
  'OIL SCREEN': '오일 스크린',
  'O-RING': 'O링',
  'WATER PUMP': '워터 펌프',
  'WATER & HEATER PIPE': '워터/히터 파이프',
  'WATER & OIL PUMP': '워터/오일 펌프',
  'RADIATOR': '라디에이터',
  'INTER COOLER': '인터쿨러',
  'TURBO CHARGER': '터보차저',
  'COMMON RAIL': '커먼레일',
  'SPARK PLUG': '스파크 플러그',
  'IGNITION COIL': '점화 코일',
  'O2 SENSOR': 'O2 센서',
  'PRESSURE SENSOR': '압력 센서',
  'SENSOR': '센서',
  'THERMOSTAT': '서모스탯',
  'EMS': 'EMS',
  'ECU': 'ECU',
  'TCU': 'TCU',
  'CATALYST CONVERTER': '촉매 컨버터',
  'E,G,R COOLER': 'EGR 쿨러',
  'E,G,R VALVE': 'EGR 밸브',
  'GASKET': '가스켓',
  'TIE ROD & END': '타이로드/엔드',
  'ENGINE MOUNTING': '엔진 마운팅',
  'DAMPER PULLEY': '댐퍼 풀리',
  'GAP FILLER': '갭 필러',
  'PRA': 'PRA',
  'FLY WHEEL HOUSING': '플라이휠 하우징',
  'PULLY': '풀리',
  'PULLEY': '풀리',
  'TORSION BAR': '토션 바',
  'GAS SPRING': '가스 스프링',

  # 변속/구동
  'TORQUE CONVERTER': '토크 컨버터',
  'T/M': '미션',
  'T/M SHAFT': '미션 샤프트',
  'DRIVE GEAR': '드라이브 기어',
  'DRIVE PLATE': '드라이브 플레이트',
  'PROPELLER SHAFT': '프로펠러 샤프트',
  'AXLE': '액슬',
  'REAR AXLE': '리어 액슬',
  'BEVERL GEAR': '베벨 기어',
  'SYNCHRONIZER HUB': '싱크로나이저 허브',
  'SPROCKET': '스프로킷',
  'RETAINER RING': '리테이너 링',

  # 베어링
  'BEARING': '베어링',
  'BALL & TAPER BEARING': '볼/테이퍼 베어링',
  'WHEEL HUB BEARING': '휠 허브 베어링',

  # 조향/제동
  'STEERING WHEEL': '스티어링 휠',
  'STEERING GEAR & LINKAGE': '스티어링 기어/링크',
  "P/W STR'G OIL PUMP": '파워 스티어링 오일 펌프',
  'POWER STEERING HOSE': '파워 스티어링 호스',
  'KNUCKLE': '너클',
  'BRAKE DRUM & DISC': '브레이크 드럼/디스크',
  'BRAKE DISC': '브레이크 디스크',
  'BRAKE DRUM': '브레이크 드럼',
  'BRAKE LINING & PAD': '브레이크 라이닝/패드',
  'BRAKE TUBE': '브레이크 튜브',
  'LOWER ARM': '로어 암',
  'SHOCK ABSORBER': '쇼크 업소버',

  # 와이퍼/창문
  'WIPER ARM & BLADE': '와이퍼 암/블레이드',
  'WIPER SYSTEM': '와이퍼 시스템',
  'GLASS & SEALINGS': '글래스/씰링',
  'SUN ROOF': '선루프',

  # 휠/타이어
  'TIRE': '타이어',
  'TIRE TUBE': '타이어 튜브',
  'AL, WHEEL DISC': '알루미늄 휠 디스크',
  'WHEEL DISC(STEEL)': '스틸 휠 디스크',

  # 전장/와이어링/배터리
  'WIRE HARNESS': '와이어링 하네스',
  'JUNCTION BOX': '정션박스',
  'CONNECTOR': '커넥터',
  'CABLE용 CONNECTOR': '케이블용 커넥터',
  'CONTROL CABLE': '컨트롤 케이블',
  'BATTERY': '배터리',
  'BATTERY CABLE': '배터리 케이블',
  'EV BATTERY CASE': 'EV 배터리 케이스',
  'EV용 배터리': 'EV용 배터리',
  '소형 IT 배터리': '소형 IT 배터리',
  'RELAY': '릴레이',
  'SWITCH': '스위치',
  'CONTROL SWITCH': '컨트롤 스위치',
  'ANTENNA': '안테나',
  'POWER ANTENNA': '파워 안테나',
  'MOTOR': '모터',
  'BLDC MOTOR': 'BLDC 모터',
  'ALTERNATOR': '알터네이터',
  'STARTER': '스타터',
  'AIR BAG': '에어백',
  'CAR AUDIO': '카 오디오',
  'AVN': 'AVN',
  'AVN & SMART AUDIO': 'AVN/스마트오디오',
  'ADAS': 'ADAS',
  'AS부품': 'A/S 부품',

  # 공조/필터
  'AIR CONDITIONER': '에어컨',
  'COMPRESSOR': '컴프레서',
  'HVAC MODULE': 'HVAC 모듈',
  'HOSE류': '호스류',
  'RUBBER HOSE': '고무 호스',
  'AIR DUCT': '에어 덕트',
  'DUCT': '덕트',
  'FILTER류': '필터류',

  # 패스너
  'BOLT': '볼트',
  'NUT': '너트',
  'BOLT & NUT': '볼트/너트',
  'PLASTIC FASTENER': '플라스틱 패스너',

  # 배기
  'MUFFLER': '머플러',
  'MUFFLER & PIPE': '머플러/파이프',

  # 기타
  'HYDRAULIC PUMP': '유압 펌프',
  'GEAR BOX BRACKET': '기어박스 브래킷',
  'CMB 등 고무소재': '고무 소재',
  '4WD/구동시스템': '4WD/구동시스템',
  '공조/열관리(HVAC)': '공조/열관리',
  '공작기계': '공작기계',
  '구동축(HalfShaft)': '구동축(하프샤프트)',
  '등속조인트': '등속조인트',
  '동력전달부품': '동력전달부품',
  '서스펜션': '서스펜션',
  '스티어링': '스티어링',
  '엔진': '엔진',
  '브레이크': '브레이크',
  '도어트림': '도어 트림',
  '범퍼': '범퍼',
  '머플러': '머플러',
  '배기시스템': '배기시스템',
  '모듈/샤시': '모듈/샤시',
  '변속기/구동계 모듈': '변속기/구동계 모듈',
  '수소연료탱크': '수소연료탱크',
  '경량화 자동차 부품': '경량화 자동차 부품',
  '자동차 부품': '자동차 부품',
  '자동차 차체부품': '자동차 차체부품',
  '2차전지 양극재': '2차전지 양극재',
  '지주회사': '지주회사',
}


# ──────────────────────────────────────────────
# 분리/번역 로직
# ──────────────────────────────────────────────

# 분리 구분자: , & 또는 슬래시(단, 'AVN/스마트오디오' 같은 한글 슬래시는 유지하기 위해 영문 분리만 우선)
SPLIT_RE = re.compile(r'\s*,\s*|\s*&\s*|\s+등\s*$')


def _normalize_token(token: str) -> str:
  """공백 정규화 후 매핑 룩업, 실패 시 원문 반환."""
  s = token.strip()
  if not s:
    return ''
  s_clean = re.sub(r'\s+', ' ', s)
  upper = s_clean.upper()
  if upper in TRANSLATION:
    return TRANSLATION[upper]
  if s_clean in TRANSLATION:
    return TRANSLATION[s_clean]
  # "필터류" "MOTOR류" 처럼 접미 류 처리
  if upper.endswith('류') and upper[:-1] in TRANSLATION:
    return TRANSLATION[upper[:-1]] + '류'
  if s_clean.endswith('류'):
    base = s_clean[:-1].upper()
    if base in TRANSLATION:
      return TRANSLATION[base] + '류'
  return s_clean  # 매핑 없으면 그대로


def _split_and_translate(name: str) -> list[str]:
  """제품명 문자열을 분리 + 한글로 변환 후 dedupe된 리스트 반환."""
  if not name:
    return []
  raw = name.replace(' ', ' ')
  tokens = [t for t in SPLIT_RE.split(raw) if t]
  result: list[str] = []
  seen: set[str] = set()
  for tok in tokens:
    translated = _normalize_token(tok)
    if translated and translated not in seen:
      result.append(translated)
      seen.add(translated)
  return result


def normalize_company_products(products: list[dict]) -> list[dict]:
  """한 회사의 products 리스트를 정규화한다."""
  result: list[dict] = []
  seen: set[str] = set()
  for p in products or []:
    name = (p or {}).get('name', '')
    share_pct = (p or {}).get('share_pct')
    items = _split_and_translate(name)
    for item in items:
      if item in seen:
        continue
      seen.add(item)
      entry: dict = {'name': item}
      if share_pct is not None and len(items) == 1:
        entry['share_pct'] = share_pct
      result.append(entry)
  return result


def main() -> None:
  client = get_client()
  rows = (
    client.table('companies')
      .select('id,name_kr,products')
      .execute()
      .data
  )
  applied = 0
  for r in rows:
    products = r.get('products') or []
    if not products:
      continue
    normalized = normalize_company_products(products)
    if normalized != products:
      client.table('companies').update({'products': normalized}).eq('id', r['id']).execute()
      logger.info(f"✓ {r['name_kr']}: {[p['name'] for p in products]} → {[p['name'] for p in normalized]}")
      applied += 1
  logger.info(f'정규화 적용: {applied}개 회사')


if __name__ == '__main__':
  try:
    main()
  except Exception as e:
    logger.error(f'정규화 실패: {e}')
    sys.exit(1)
