"""주요 회사 홈페이지 URL 일괄 매핑.

매출 TOP 80+ 회사의 공식 홈페이지 URL.
이미 homepage_url 있는 회사는 보존(/related-stocks 25개 보호).
"""
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
load_dotenv(ROOT.parent / '.env.local')

from lib.db import get_client

# ticker → homepage_url
URL_MAP: dict[str, str] = {
  # 매출 TOP 30
  '012330': 'https://www.mobis.co.kr',
  '373220': 'https://www.lgensol.com',
  '161390': 'https://www.hankooktire.com',
  '현대트랜시스': 'https://www.hyundai-transys.com',
  '006400': 'https://www.samsungsdi.co.kr',
  '018880': 'https://www.hanonsystems.com',
  '204320': 'https://www.hl-mando.com',
  '011210': 'https://www.hyundai-wia.com',
  '007860': 'https://www.seoyon.com',
  '073240': 'https://www.kumhotire.com',
  '200880': 'https://www.seoyon-ehwa.com',
  '015750': 'https://www.swhi.co.kr',
  '007340': 'https://www.dn-automotive.com',
  '002350': 'https://www.nexentire.com',
  '현대케피코': 'https://www.hyundai-kefico.com',
  '038110': 'https://www.ecoplastic.co.kr',
  '247540': 'https://www.ecoprobm.com',
  '유라코퍼레이션': 'https://www.yura.co.kr',
  '036530': 'https://www.s-ntcorp.com',
  '004490': 'https://www.globalbattery.com',
  '일진글로벌': 'https://www.iljinglobal.com',
  '033530': 'https://www.sjg.co.kr',
  '123040': 'https://www.msautotech.com',
  '024900': 'https://www.dukyang.co.kr',
  '010100': 'https://www.movenex.com',
  '013520': 'https://www.hscorporation.com',
  '053700': 'https://www.sambomotors.co.kr',
  '067570': 'https://www.nvhkorea.com',
  '000430': 'https://www.dwkorea.co.kr',
  # 31-60
  '카펙발레오': 'https://www.capecvaleo.co.kr',
  '000240': 'https://www.hankookncompany.com',
  '060980': 'https://www.hlholdings.com',
  '엠씨넥스': 'https://www.mcnex.com',
  '현대성우홀딩스': 'https://www.swauto.co.kr',
  '043370': 'https://www.phakorea.com',
  '012860': 'https://www.mobasekr.com',
  '064960': 'https://www.snt-motiv.co.kr',
  '019180': 'https://www.thn.co.kr',
  '010770': 'https://www.phcgroup.co.kr',
  '019540': 'https://www.iljitech.co.kr',
  '001620': 'https://www.kbidi.co.kr',
  '016740': 'https://www.dwbk.co.kr',
  '143210': 'https://www.hands-corp.com',
  '현대성우캐스팅': 'https://www.swauto.co.kr',
  '동희산업': 'https://www.donghee.com',
  '023800': 'https://www.inzi.com',
  '003570': 'https://www.snt-dynamics.co.kr',
  '평화발레오': 'https://www.phvaleo.com',
  '024910': 'https://www.kicc.co.kr',
  '072470': 'https://www.woory.com',
  '118990': 'https://www.motrex.co.kr',
  '002880': 'https://www.dy-co.com',
  '018500': 'https://www.dwm.co.kr',
  '090080': 'https://www.phcgroup.co.kr',
  '023810': 'https://www.inpack.co.kr',
  '041650': 'https://www.sangsinbrake.com',
  '122350': 'https://www.samkee.co.kr',
  '025440': 'https://www.dh-autoware.com',
  '한세모빌리티': 'https://www.iraegroup.com',  # 이미 있음 — 덮어쓰기 방지 필요
  # 추가 알려진 회사
  '이래CS': 'https://www.iraegroup.com',
  '에스트라오토모티브시스템': 'https://www.estraats.com',
  '서연전자': 'https://www.seoyon.com',
  '서연오토비전': 'https://www.seoyonav.com',
  '서연씨엔에프': 'https://www.seoyon.com',
  '서연인테크': 'https://www.seoyonintech.com',
  '서진산업': 'https://www.seojin.co.kr',
  '서진캠': 'https://www.seojincam.co.kr',
  '서한산업': 'https://www.seohan.com',
  '캄텍': 'https://www.kamtec.co.kr',
  '한국프랜지공업': 'https://www.hkflange.com',
  '현대성우메탈': 'https://www.swauto.co.kr',
  '현대성우쏠라이트': 'https://www.solite.co.kr',
  '에이치엘일렉트로닉스': 'https://www.hl-electronics.com',
  'HSL일렉트로닉스': 'https://www.hl-electronics.com',
  'SL': 'https://www.slworld.com',
  '평화기공': 'https://www.phcgroup.co.kr',
  '평화오일씰공업': 'https://www.phcgroup.co.kr',
  '평화정공': 'https://www.phcgroup.co.kr',
  '아산성우하이텍': 'https://www.swhi.co.kr',
  '일진베어링': 'https://www.iljinbearing.com',
  '명신': 'https://www.myungshin.co.kr',
  '심원개발': 'https://www.shimwon.co.kr',
  '심원테크': 'https://www.shimwon.co.kr',
  '009900': 'https://www.myungshinind.co.kr',
  '가레트모션코리아': 'https://www.garrettmotion.com',
  '발레오전장시스템스코리아': 'https://www.valeo.com',
  '삼성발레오써멀시스템스': 'https://www.valeo.com',
  '한국델파이': 'https://www.bwicareers.com',
  '셰플러코리아': 'https://www.schaeffler.kr',
  '셰플러안산': 'https://www.schaeffler.kr',
  '보쉬전장': 'https://www.bosch.co.kr',
  '로버트보쉬코리아': 'https://www.bosch.co.kr',
  '한국보그워너티에스': 'https://www.borgwarner.com',
  '보그워너창녕': 'https://www.borgwarner.com',
  '덴소코리아': 'https://www.denso.co.kr',
  '콘티넨탈오토모티브일렉트로닉스': 'https://www.continental.com',
  '비테스코테크놀로지스코리아': 'https://www.vitesco-technologies.com',
  '말레동현필터시스템': 'https://www.mahle.com',
  '만앤휴멜코리아': 'https://www.mann-hummel.com',
  '제트에프삭스코리아': 'https://www.zf.com',
  '제트에프오토모티브코리아': 'https://www.zf.com',
  '니덱모빌리티코리아': 'https://www.nidec.com',
  '니프코코리아': 'https://www.nifco.com',
  '동서페더럴모굴': 'https://www.tenneco.com',
  '페더럴모굴세종': 'https://www.tenneco.com',
  '오토리브': 'https://www.autoliv.com',
  '조이슨세이프티시스템스코리아': 'https://www.joynext.com',
  '한국아이티더블유': 'https://www.itw.com',
  '아이티더블유오토모티브코리아': 'https://www.itw.com',
  '리어코리아': 'https://www.lear.com',
  '애디언트동성': 'https://www.adient.com',
  '애디언트코리아': 'https://www.adient.com',
  '쿠퍼스탠다드오토모티브앤인더스트리얼': 'https://www.cooperstandard.com',
  '포레시아코리아': 'https://www.forvia.com',
  '플라스틱옴니엄': 'https://www.opmobility.com',
  '브로제코리아': 'https://www.brose.com',
  '센싸타테크놀러지스코리아': 'https://www.sensata.com',
  '스타빌루스': 'https://www.stabilus.com',
  '엘링크링거코리아': 'https://www.elringklinger.com',
  '타이코에이엠피': 'https://www.te.com',
  '이튼인더스트리즈': 'https://www.eaton.com',
  '존슨일렉트릭오퍼레이션스': 'https://www.johnsonelectric.com',
  '파카코리아': 'https://www.parker.com',
  '파카하니핀커넥터': 'https://www.parker.com',
  '베바스토코리아홀딩스': 'https://www.webasto.com',
  '베바스토코리아': 'https://www.webasto.com',
  '에스엠알오토모티브모듈코리아': 'https://www.smr-automotive.com',
  '한국유미코아촉매': 'https://www.umicore.kr',
  '희성촉매': 'https://www.heesungcatalysts.com',
  '한국쓰리엠': 'https://www.3m.co.kr',
  '한국쯔바키모토오토모티브': 'https://www.tsubakimoto.com',
  '한국엔에스케이': 'https://www.kr.nsk.com',
  '한국에스케이에프씰': 'https://www.skf.com',
  '한국알프스': 'https://www.alpsalpine.com',
  '클라리오스델코': 'https://www.clarios.com',
  '한국후꼬꾸': 'https://www.fukoku-kr.com',
  '디에이치오토리드': 'https://www.dh-autoware.com',
  '카이엠': 'https://www.kayem.co.kr',
  '카이스': 'https://www.kais.kr',
  '대유에이텍': 'https://www.daeyu-atech.co.kr',
  '대유플러스': 'https://www.daeyuplus.com',
  '대유글로벌': 'https://www.daeyu-global.com',
  '대원산업': 'https://www.daewonsi.co.kr',
  '대주코레스': 'https://www.daejucores.co.kr',
  '대주정공': 'https://www.dj-jjk.co.kr',
  '동희정공': 'https://www.donghee.com',
  '동희하이테크': 'https://www.donghee.com',
  '동희': 'https://www.donghee.com',
  '아이아': 'https://www.aiacorp.com',
  '디와이덕양': 'https://www.dukyang.co.kr',
  '에스엘': 'https://www.slworld.com',
  '한주라이트메탈': 'https://www.hjlm.co.kr',
  '디와이': 'https://www.dy-co.com',
}


def main() -> None:
  client = get_client()
  applied = 0
  for ticker, url in URL_MAP.items():
    rows = client.table('companies').select('id,homepage_url').eq('ticker', ticker).execute().data
    if not rows:
      continue
    r = rows[0]
    if r.get('homepage_url'):  # 보존
      continue
    client.table('companies').update({'homepage_url': url}).eq('id', r['id']).execute()
    applied += 1

  print(f'홈페이지 URL 적용: {applied}건 / 매핑 사전: {len(URL_MAP)}건')


if __name__ == '__main__':
  main()
