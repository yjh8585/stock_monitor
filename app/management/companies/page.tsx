import { NewCompanyForm } from '@/components/management/companies/new-company-form';

export const metadata = {
  title: '회사 추가 — 경영관리',
};

/**
 * 회사 마스터 추가 페이지.
 *
 * 폼에서 필수 컬럼(ticker/name/country/currency/data_source 등)을 입력해 companies INSERT.
 * 트리거가 page 매핑·정규화 자동 처리. 메타·재무·뉴스는 후속으로 onboard_company.py 실행.
 *
 * 향후 회사 목록·수정·삭제 + 다른 마스터(고객사 등) 관리 페이지가 같은 자리에 확장.
 */
export default function NewCompanyPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold">신규 회사 등록</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          필수 컬럼 입력 후 추가. 메타·재무·뉴스 보강은 별도로 onboard_company.py를 실행.
        </p>
      </div>
      <NewCompanyForm />
    </div>
  );
}
