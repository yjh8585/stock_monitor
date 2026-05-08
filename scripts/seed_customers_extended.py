"""매출 31~120위 회사 customers + products 보강.

KAICA로 채운 product 외에 customers는 거의 비어있음.
대부분 한국 자동차 부품사는 현대차/기아 1차 또는 2차 벤더라 그 정보로 채움.
"""
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

from lib.db import get_client

# ticker → customers (대부분 1차 벤더)
HD_KIA = [{'name': '현대차'}, {'name': '기아'}]
HD_KIA_GM = [{'name': '현대차'}, {'name': '기아'}, {'name': 'GM'}]
HD_KIA_FORD = [{'name': '현대차'}, {'name': '기아'}, {'name': '포드'}]
GLOBAL_AUTO = [{'name': '현대차'}, {'name': '기아'}, {'name': 'GM'}, {'name': '포드'}, {'name': '폭스바겐'}]

CUSTOMERS_MAP: dict[str, list[dict]] = {
  # 31-60
  '카펙발레오': HD_KIA, '엠씨넥스': HD_KIA, '043370': HD_KIA, '012860': HD_KIA,
  '064960': HD_KIA, '019180': HD_KIA, '019540': HD_KIA, '001620': HD_KIA,
  '016740': HD_KIA, '143210': GLOBAL_AUTO, '현대성우캐스팅': HD_KIA,
  '동희산업': HD_KIA, '023800': HD_KIA, '003570': HD_KIA, '평화발레오': HD_KIA,
  '024910': HD_KIA, '118990': HD_KIA, '002880': HD_KIA, '018500': HD_KIA,
  '090080': HD_KIA, '023810': HD_KIA, '041650': HD_KIA, '122350': HD_KIA,
  '025440': HD_KIA, '한세모빌리티': HD_KIA, 'SL': HD_KIA, '서연전자': HD_KIA,
  '이래CS': HD_KIA, '에스트라오토모티브시스템': HD_KIA,
  # 추가
  '085910': HD_KIA, '대원산업': HD_KIA, 'HSL일렉트로닉스': HD_KIA,
  '한국프랜지공업': HD_KIA, '서한산업': HD_KIA, '캄텍': HD_KIA, '서연이화': HD_KIA,
  '서연인테크': HD_KIA, '서연오토비전': HD_KIA, '서연씨엔에프': HD_KIA,
  '아이아': HD_KIA, '서진산업': HD_KIA, '서진캠': HD_KIA,
  '평화기공': HD_KIA, '평화오일씰공업': HD_KIA, '평화정공': HD_KIA,
  '아산성우하이텍': HD_KIA, '일진베어링': HD_KIA, '명신': HD_KIA,
  '심원개발': HD_KIA, '심원테크': HD_KIA, '009900': HD_KIA,
  '동희정공': HD_KIA, '동희하이테크': HD_KIA, '베바스토코리아': HD_KIA,
  # 외국계
  '가레트모션코리아': [{'name': '현대차'}, {'name': '기아'}, {'name': '글로벌 OEM'}],
  '발레오전장시스템스코리아': HD_KIA,
  '삼성발레오써멀시스템스': HD_KIA,
  '한국델파이': HD_KIA,
  '셰플러코리아': GLOBAL_AUTO, '셰플러안산': GLOBAL_AUTO,
  '보쉬전장': GLOBAL_AUTO, '로버트보쉬코리아': GLOBAL_AUTO,
  '한국보그워너티에스': HD_KIA, '보그워너창녕': HD_KIA, '부라다워너': HD_KIA,
  '덴소코리아': HD_KIA,
  '콘티넨탈오토모티브일렉트로닉스': GLOBAL_AUTO,
  '비테스코테크놀로지스코리아': GLOBAL_AUTO,
  '말레동현필터시스템': HD_KIA, '만앤휴멜코리아': GLOBAL_AUTO,
  '제트에프삭스코리아': GLOBAL_AUTO, '제트에프오토모티브코리아': GLOBAL_AUTO,
  '니덱모빌리티코리아': HD_KIA, '니프코코리아': HD_KIA,
  '동서페더럴모굴': GLOBAL_AUTO, '페더럴모굴세종': GLOBAL_AUTO,
  '오토리브': GLOBAL_AUTO, '조이슨세이프티시스템스코리아': GLOBAL_AUTO,
  '한국아이티더블유': GLOBAL_AUTO, '아이티더블유오토모티브코리아': GLOBAL_AUTO,
  '리어코리아': GLOBAL_AUTO, '애디언트동성': GLOBAL_AUTO, '애디언트코리아': GLOBAL_AUTO,
  '쿠퍼스탠다드오토모티브앤인더스트리얼': GLOBAL_AUTO,
  '포레시아코리아': GLOBAL_AUTO, '플라스틱옴니엄': GLOBAL_AUTO,
  '브로제코리아': GLOBAL_AUTO, '센싸타테크놀러지스코리아': GLOBAL_AUTO,
  '엘링크링거코리아': GLOBAL_AUTO, '에스엠알오토모티브모듈코리아': HD_KIA,
  '한국유미코아촉매': HD_KIA, '희성촉매': HD_KIA, '한국쓰리엠': GLOBAL_AUTO,
  '한국쯔바키모토오토모티브': HD_KIA, '한국엔에스케이': GLOBAL_AUTO,
  '한국에스케이에프씰': GLOBAL_AUTO, '한국알프스': HD_KIA,
  '클라리오스델코': GLOBAL_AUTO, '한국후꼬꾸': HD_KIA,
  '베바스토코리아홀딩스': HD_KIA,
}

# product 누락 회사 보강
PRODUCTS_MAP: dict[str, list[dict]] = {
  '현대성우홀딩스': [{'name': '지주회사'}],
  '평화홀딩스': [{'name': '지주회사'}],
  '060980': [{'name': '지주회사 (HL그룹)'}],
  '000240': [{'name': '지주회사 (한국타이어그룹)'}],
  '072470': [{'name': '지주회사 (우리산업그룹)'}],
  '한세모빌리티': [{'name': '제동/조향/전자제어'}],
  '이래CS': [{'name': '자동차 차체부품'}],
  '에스트라오토모티브시스템': [{'name': '공조/조향/제동시스템'}],
  '엠씨넥스': [{'name': '카메라모듈'}, {'name': '센서'}],
  '247540': [{'name': '2차전지 양극재'}],
  '서연': [{'name': '도어트림'}, {'name': '콘솔'}, {'name': '범퍼'}],
  '036530': [{'name': '지주회사'}],
  '009900': [{'name': '차체부품'}, {'name': '핫스탬핑'}],
  '서연전자': [{'name': '키세트'}, {'name': '스위치'}],
  '서연오토비전': [{'name': '도어트림'}, {'name': '램프'}],
  '서연씨엔에프': [{'name': '시트'}],
  'SL': [{'name': '램프'}, {'name': '샤시'}, {'name': '스티어링'}],
  'HSL일렉트로닉스': [{'name': 'LED 모듈'}, {'name': '페달 모듈'}],
  '한국프랜지공업': [{'name': '엔진 플랜지'}, {'name': '엔진부품'}],
  '서한산업': [{'name': '드라이브 샤프트'}, {'name': 'CV 조인트'}],
  '캄텍': [{'name': '배기가스 저감장치'}, {'name': 'EGR 밸브'}],
  '아이아': [{'name': '엔진 마운팅'}, {'name': '범퍼'}],
  '서진산업': [{'name': '프레임'}, {'name': '샤시'}],
  '서진캠': [{'name': '캠샤프트'}],
  '평화기공': [{'name': '기어박스 브래킷'}, {'name': '방진제품'}],
  '평화오일씰공업': [{'name': '오일씰'}, {'name': 'O링'}],
  '평화정공': [{'name': '도어 래치'}, {'name': '힌지'}],
  '아산성우하이텍': [{'name': '프레스 부품'}, {'name': '문짝'}],
  '일진베어링': [{'name': '휠 베어링'}, {'name': '드라이브 샤프트'}],
  '심원개발': [{'name': '핫스탬핑'}],
  '심원테크': [{'name': '경량화 자동차 부품'}],
  '명신': [{'name': '필터'}, {'name': '프로텍터'}],
  '동희정공': [{'name': '연료탱크'}, {'name': '페달'}],
  '동희하이테크': [{'name': '리어서스펜션 모듈'}, {'name': '연료탱크 모듈'}],
}


def main() -> None:
  client = get_client()
  c_applied, p_applied = 0, 0
  for ticker, customers in CUSTOMERS_MAP.items():
    rows = client.table('companies').select('id,customers').eq('ticker', ticker).execute().data
    if not rows:
      continue
    r = rows[0]
    if r.get('customers') and len(r['customers']) > 0:
      continue
    client.table('companies').update({'customers': customers}).eq('id', r['id']).execute()
    c_applied += 1
  for ticker, products in PRODUCTS_MAP.items():
    rows = client.table('companies').select('id,products').eq('ticker', ticker).execute().data
    if not rows:
      continue
    r = rows[0]
    if r.get('products') and len(r['products']) > 0:
      continue
    client.table('companies').update({'products': products}).eq('id', r['id']).execute()
    p_applied += 1
  print(f'customers 적용: {c_applied}건 / products 적용: {p_applied}건')


if __name__ == '__main__':
  main()
