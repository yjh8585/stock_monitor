-- 휴머노이드 「모터」 탭 비상장사 회사 설명(business_summary) 채움 — 2026-11-27 사용자 지시
-- 「모터 페이지 회사들 기업개요(회사설명)이 없네」 · 모터 회사는 enrich_company.py 보강 제외라 빈 칸이었다.
-- 출처 = 홈페이지·웹 원문(DART 제외) · 근거 발췌는 Codex 가 사실 대조 · 빈 칸일 때만 쓴다(2026-09-16 결정 3).

-- 대동모벨시스템
UPDATE companies SET business_summary = $s$대동모벨시스템은 2002년 대동시스템에서 분사해 설립된 자동차 부품 제조업체로, 본사는 경기도 시흥시에 있다. 제품군은 시트 코어품, 모터·액추에이터, 전장 제어 유닛, 산업용 모터이며, 주생산품은 슬라이드 기어박스, 리모트 폴딩·워크인 액추에이터, 트렁크 자동 개폐 모터, EVP(전동 진공펌프) 모터다. 산업용 모터로는 자동문·엘리베이터 도어용 DD 모터와 산업 자동화·로봇용 서보모터를 만든다. 베트남(VIKOM)과 중국(청도 대동모벨)에 해외 법인을 두고 있다.$s$, summary_updated_at = now()
WHERE id = '4bc68100-98b6-4e1a-a787-26c8ce6900a0' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 승일일렉트로닉스
UPDATE companies SET business_summary = $s$승일일렉트로닉스는 1987년 설립된 산업장비 제어기기 제조업체로, 경기도 부천시에 있다. 산업장비 제어용 마이컴(MICOM) 컨트롤러와 인버터, 전극봉식 가습기, 자동제어시스템, 온습도 변환기 등을 생산한다. 냉동공조·냉동냉장 분야에서는 BLDC 인버터, 전자식 팽창밸브 컨트롤러·드라이버, 디지털 압력 스위치, 가변용량 시스템 컨트롤러로 구성된 BLDC 인버터 컴프레서 통합 제어 솔루션을 국산화했다.$s$, summary_updated_at = now()
WHERE id = 'f66aed6a-29a0-4452-abce-57d8ade24b15' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 엘지마그나이파워트레인
UPDATE companies SET business_summary = $s$엘지마그나이파워트레인(LG Magna e-Powertrain)은 2021년 7월 LG전자와 Magna International이 공동 설립한 합작법인이다. 구동모터, 전력변환장치, 통합솔루션 등 전기차 부품 솔루션을 제공한다. 한국 인천, 중국 남경, 멕시코 라모스 아리즈페에 생산공장을 두고 있으며, 2024년 헝가리 미슈콜츠에 생산법인을 설립했다.$s$, summary_updated_at = now()
WHERE id = '67f4e833-61ac-4ee7-88ee-773aac056890' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 이노빌
UPDATE companies SET business_summary = $s$이노빌은 2014년 (주)화신과 경북대학교 기술지주회사의 산학협력으로 창립된 친환경 자동차 부품 기업으로, 대구광역시 달서구에 있다. 제품군은 전동식 워터펌프·진공펌프 등 차량용 펌프 모듈, EHPS·쿨링 팬 모터 제어기 등 차량용 전자 제어 ECU, 모터 제어기·차체 제어기·계기판·DC-DC 컨버터로 이뤄진 이모빌리티 구동 플랫폼, 통신 모듈·관성 측정 모듈 등 스마트 모듈이다. 3륜 전동차 구동 플랫폼과 전동 휠체어용 모터 제어기를 양산했다.$s$, summary_updated_at = now()
WHERE id = 'a03ede68-6c47-42c0-acbc-ae082f26697d' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 파스텍
UPDATE companies SET business_summary = $s$파스텍은 모션 컨트롤 분야 전문 기업으로, 경기도 부천시 부천테크노파크에 있다. 주력 기술인 폐루프 스테핑 시스템(Closed Loop Stepping System) 「Ezi-SERVO」를 비롯해 모션 제어기, 오픈 루프 스테핑 시스템, 필드 네트워크 솔루션, 기구와 결합한 유닛 제품을 공급한다. 폐루프 스테핑 시스템은 LCD/LED 제조, 반도체 공정, 조립·포장, 의료기기, 비전 검사 기기 등 정밀 제어가 필요한 산업 분야에 쓰인다.$s$, summary_updated_at = now()
WHERE id = 'f2dacc33-f8ba-421d-b75d-094b13c5ccb2' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 드라이브텍
UPDATE companies SET business_summary = $s$드라이브텍은 2016년 설립된 친환경 소형 모빌리티·자율주행 로봇 플랫폼 업체로, 본사는 충남 천안시, 공장은 경기 시흥시에 있다. 제품으로 산업 현장용 이송 로봇, 스마트팜 시설농업용 실내 주행 로봇(FarmBot), 전동화 파워 솔루션, 모터를 연결하면 바로 구동되는 범용 원격 제어 제품 등을 소개한다. 산업용 로봇에 쓰이는 BLDC·DC 모터 컨트롤러·드라이버와 스마트 모터, 로터리 스마트 액추에이터를 제품으로 내놓았으며, 2019년 전기차 변속기용 전기식 액추에이터를 개발했다.$s$, summary_updated_at = now()
WHERE id = '316566dd-d350-4ac5-9b3a-f3cc086ca1fd' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 씨앤엠
UPDATE companies SET business_summary = $s$씨앤엠은 1980년 LG전자 모터사업부에서 출발해 2006년 9월 LG전자에서 분사·설립된 모터 전문 기업으로, 본사는 경남 김해시에 있다. 제품군은 전동식 컴프레셔·공기 압축기·구동 모터 등 xEV용 모터, 변속기용 액추에이터 모터·전동식 파워 스티어링 모터 등 차량용 전장 모터, 가전 모터, 로봇 모터다. 국내 아산·부산과 중국 남경·연태에 공장을 두고 있으며, LG전자와 공동 개발한 데이터센터 냉각용 EC 모터를 납품하고 로봇 관절 액추에이터를 개발하고 있다.$s$, summary_updated_at = now()
WHERE id = '7f999dc6-eeb8-4d8c-bf60-6adf4f085ba5' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 우진산전
UPDATE companies SET business_summary = $s$우진산전은 1974년 설립된 철도차량·전기버스 제조업체로, 본사는 충북 괴산에 있다. 철도차량 핵심 전장품의 국산화로 출발해 철도 완성차 제작, 검수설비, 수소 열차, 전기·수소버스로 사업을 넓혔다. 전동차·경전철 등 철도 완성차와 함께 차량에 들어가는 추진·전력·제어 시스템 부품을 설계·제조하며, 증평·오창·김천에 공장을 두고 있다.$s$, summary_updated_at = now()
WHERE id = '9060d11d-417c-44b0-b5b8-7677c5c81999' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 인텍에프에이
UPDATE companies SET business_summary = $s$인텍에프에이는 1999년 설립된 전력전자 전문 제조업체로, 본사는 경기 용인시 기흥구에 있고 충남 아산에 공장을 두고 있다. 전동기 제어용 인버터와 인버터 옵션, AC·BLDC 모터 드라이브, 서보 앰프, 산업용 로봇 제어기, 클린룸 팬 구동·제어 장치, 태양광 시스템용 전력변환장치(PCS) 등을 생산한다. LCD·OLED 공정에 쓰이는 로봇 제어기를 ODM 형태로 공급한다.$s$, summary_updated_at = now()
WHERE id = '231961a2-966b-4862-92fc-54c4c5c9e6eb' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 패러데이다이나믹스
UPDATE companies SET business_summary = $s$패러데이다이나믹스는 2020년 설립된 서보모터·로봇 구동기 개발업체로, 본사는 인천광역시에 있다. 고토크밀도 서보모터 FD 시리즈를 1단 유성감속기를 내장한 QDD(Quasi-Direct Drive) 모델과 감속기 없이 직접 구동하는 DD(Direct Drive) 모델로 내놓고 있다. 협동로봇·휴머노이드·4족보행 로봇·착용형 로봇·물류로봇을 적용 분야로 두고 있으며, 서보모터 제조 공정의 90% 이상을 내재화했다.$s$, summary_updated_at = now()
WHERE id = '5fa5faa0-28d0-418a-8fa2-0eff4bf0ec25' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 만도브로제
UPDATE companies SET business_summary = $s$만도브로제는 한국의 (주)만도와 독일 자동차 부품 회사 Brose가 공동으로 합작해 2011년 설립한 자동차 모터 전문 회사로, 인천 연수구 송도동에 공장을 두고 있다. 지능형 샤시시스템용 브러쉬리스 전기모터를 공급하고 EPS(전동식파워스티어링)용 모터를 한국 주요 자동차 업체에 공급하며, 제품군은 C-EPS 모터와 R-EPS 모터 등이다. 2012년 공장을 완공하고 2013년 양산을 시작했다.$s$, summary_updated_at = now()
WHERE id = '3f848d0d-e17c-4468-8ee1-81c4e78b178e' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 아이알로봇
UPDATE companies SET business_summary = $s$아이알로봇은 2003년 창립한 마이크로 리니어 서보 액추에이터 전문 제조사로, 경기도 부천시에 소재한다. 창립 이후 서비스로봇 제품을 선보이며 로봇 설계·제어 기술을 쌓았고, 2016년부터 소형 리니어 서보 액추에이터로 사업을 주력화했다. 드라이브 회로를 내장한 일체형 제품 mightyZAP을 만들며, 공장 자동화(생산·검사), 의료·실험실 장비, UAV·드론·군용, 로보틱스 등에 쓰인다. 교육용 휴머노이드 로봇도 개발·제조한다.$s$, summary_updated_at = now()
WHERE id = 'e5c9353d-e4a8-4971-a970-d69de92c1755' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 원진일렉트로닉스
UPDATE companies SET business_summary = $s$원진일렉트로닉스는 1994년 (주)광원으로 설립된 자동차 부품 회사로, 경기도 화성시 향남읍에 소재한다. 에어컨 증발기·외기온도·엔진 냉각수 온도센서와 차량 실내 습도·먼지 등 공기조절 관련 센서를 만들어 왔으며, BLDC 모터 분야에 진출해 배터리쿨링시스템 등에 쓰이는 모터를 양산 납품한다. BLDC 모터 제품으로는 HEV·EV 배터리 냉각용 모터 및 유닛(BCF), 차량 콘솔 블로어 유닛, HVAC 블로어 모터 등이 있다.$s$, summary_updated_at = now()
WHERE id = '38717465-4068-444f-8a64-413235da2690' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 카이테크
UPDATE companies SET business_summary = $s$카이테크는 2008년 설립된 자동차 전장모듈 전문 회사로, 본사는 전북 전주시, 공장은 전북 완주군 용진읍에 있다. 제품군은 모터제어기, 파워모듈, 발전기용 전압조정기, 마이크로 모빌리티용 제어기 등이다. 전동식 오일펌프(EOP) 제어기 등 각종 제어기를 국산화해 국내외 완성차에 양산 공급하며, 전기차·수소전기차용 제어기 모듈과 신소재 반도체를 적용한 파워모듈 개발에 주력하고 있다.$s$, summary_updated_at = now()
WHERE id = '64803b2a-d3fe-41ce-b962-d12325816b81' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 하이텍알씨디코리아
UPDATE companies SET business_summary = $s$하이텍알씨디코리아(HITEC RCD Korea)는 1973년 정밀 공방으로 출발한 회사로, 서울에 본사를 두고 미국·독일·일본·필리핀에 지역 사무소를 운영한다. 정밀 서보 액추에이터를 내놓고 있으며, 이 제품은 무인항공기(드론) 비행 제어, 협동·서비스 로봇 관절 구동, 산업 자동화, 수술 보조 로봇·재활 기기 등 의료기기, 교육·연구용, 애니매트로닉스 분야에 쓰인다.$s$, summary_updated_at = now()
WHERE id = '4561cbc5-04ae-45de-8f92-1ea34f04ade5' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 민맥스
UPDATE companies SET business_summary = $s$민맥스는 2017년 설립된 전력전자 전문기업으로, 경기도 군포시에 있다. 전력변환장치·인버터·컨버터·디지털제어기·모터드라이브를 다루며, 전기자동차 전력변환·ESS·태양광 PCS를 사업분야로 두고 대용량 인버터·DC 배전·배터리 충방전기도 소개한다. UAM 항공 모빌리티 인버터와 수소연료전지 차량용 컨버터 등을 현대자동차 등 산업 고객사에 공급해 왔다.$s$, summary_updated_at = now()
WHERE id = '4a1112be-7786-43d6-8a59-e305cb24cbf3' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 애드테크
UPDATE companies SET business_summary = $s$애드테크는 1993년 ㈜삼화엘마로 설립돼 1999년 현 상호로 바꾼 차량 공조부품 및 전장부품 제조업체다. 본사는 경상남도 창원시 마산회원구에 있고, 경기도 용인시에 연구소를 두고 있다. 주요 생산품은 자동차용 모터 액추에이터(HVAC·밸브·AFD), PTC 히터, 통풍시트용 ECU·블로어 모터, 버스 에어컨용 BLDC 모터, 충전도어모듈 컨트롤러 등이다.$s$, summary_updated_at = now()
WHERE id = '388163a3-1612-455c-bb1f-7fdd99700b65' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 웰콘시스템즈
UPDATE companies SET business_summary = $s$웰콘시스템즈는 2018년 안산 KITECH 벤처센터에서 설립된 DC 서보드라이브 전문기업으로, 본사는 안산시 단원구에 있다. 범용 DC 서보드라이브와 로봇 관절 일체형 서보 등을 만들고, 다축·고전압 DC 서보드라이브도 개발했다. 드라이브는 협동로봇·용접로봇·주차로봇·수술로봇·휴머노이드용 핸드와 자율이동로봇(AMR) 등에 쓰인다.$s$, summary_updated_at = now()
WHERE id = '0e96a08d-8dce-46fe-9bac-649d9a8ec2fb' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 코렌스이엠
UPDATE companies SET business_summary = $s$코렌스이엠은 2019년 설립된 자동차 부품 제조사로, 본사는 부산광역시 강서구에 있으며 지주사는 코렌스그룹이다. 전기 자동차부품이 사업영역이며, 사업 품목은 구동모터용 로터·스테이터, 감속기, EV 인버터, 전기 오일펌프(EOP) 등이다. 구동모터 로터는 HEV·PHEV·BEV 등 xEV에 적용된다. 해외 거점은 미국·유럽·중국에 있다.$s$, summary_updated_at = now()
WHERE id = 'd3611f2c-91f8-4a3b-92eb-7120bb439f43' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 현대모터산업
UPDATE companies SET business_summary = $s$현대모터산업은 1999년 산업용 모터·인버터·감속기 판매회사 현대산업으로 설립돼 2006년 현대모터산업(주)로 법인 전환했으며, 사옥은 경기도 시흥시에 있다. 현대일렉트릭의 특약점으로 현대 전동기·감속기·인버터를 판매하고, 주요 제품은 전동기·인버터·감속기·제어반이다. 자체 HMI 시리즈 인버터를 생산·판매하며, 회사가 만든 인버터는 쓰레기 소각장 크레인과 건설현장 오거 기계 등에 납품됐다.$s$, summary_updated_at = now()
WHERE id = 'e8f183d8-a217-4a75-b68d-b9ae2d4556dc' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 브이씨텍
UPDATE companies SET business_summary = $s$브이씨텍은 2002년 설립된 전기전자 제어장치 제조업체로, 본사는 경기도 군포시에 있다. 철도차량용 추진 제어기·신호장치·TCMS 장치·LED 조명장치·배터리팩과 전기차용 추진 인버터 및 모터, 골프카용 자율주행장치를 주요 사업으로 한다. 전기차 분야에서는 주행 인버터와 구동모터, VCU를 공급해 왔다.$s$, summary_updated_at = now()
WHERE id = '69770c54-dac5-4ae7-9d4c-a2a27e96bd7e' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 엘에스메카피온
UPDATE companies SET business_summary = $s$엘에스메카피온은 1995년 설립된 자동화 모션 분야 기업으로, 본사는 대구광역시 달서구 대구첨단산업단지에 있다. 공장자동화·산업용 로봇·반도체 장비 등 고정밀 기계장치의 핵심 부품인 인코더·서보모터·서보드라이브와 모션·로봇 시스템을 자체 기술로 개발·생산하며, 제품군에는 모션제어기·리니어모터도 있다.$s$, summary_updated_at = now()
WHERE id = '3fd9526e-943b-4d3a-8fc0-9633f4c4bfe8' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 위즈진
UPDATE companies SET business_summary = $s$위즈진은 2019년 설립된 모터·제어기 개발 기업으로, 본사는 서울특별시에 있다. 축방향 자속 모터(AFPM)의 핵심 소재인 연자성 복합소재(SMC)와 고정자를 직접 개발·생산하고, 감속기와 구동 드라이버도 자체 설계한다. 드론·로보틱스·모빌리티·항공우주 플랫폼용 전기 추진·제어 기술을 개발하며, 로봇용 프레임리스 모터를 납품했다.$s$, summary_updated_at = now()
WHERE id = '4acb0a3d-a092-4dbf-98e7-8e492fca39a5' AND (business_summary IS NULL OR btrim(business_summary) = '');

-- 코모텍
UPDATE companies SET business_summary = $s$코모텍은 1997년 설립된 서보모터 전문회사로, 본사는 경기도 성남시 중원구에 있다. PMSM(영구자석 동기) 모터를 설계·생산하며 서보모터·중공형 프레임리스 서보모터·고속 스핀들 모터·발전기·서보프레스용 모터·토크모터 등을 만든다. 지능형 로봇·휴머노이드 로봇·협동로봇과 반도체·LCD 장비, AMR/AGV, 의료기기 분야에 쓰인다.$s$, summary_updated_at = now()
WHERE id = '229633ca-1a6e-4266-bb11-002625d596cc' AND (business_summary IS NULL OR btrim(business_summary) = '');
