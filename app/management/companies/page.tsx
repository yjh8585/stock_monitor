import { Suspense } from 'react';

import { CompanyList } from '@/components/management/companies/company-list';
import { NewCompanyForm } from '@/components/management/companies/new-company-form';
import { getCompaniesList } from '@/lib/companies/source';

export const metadata = {
  title: '회사 관리 — 경영관리',
};

/**
 * 회사 마스터 추가 + 목록 페이지.
 *
 * 추가 폼은 Zod 검증·DB 트리거 후처리, 목록은 'use cache'로 캐싱.
 * 신규 회사 INSERT 시 revalidateTag('companies')로 목록 자동 stale.
 */
export default function CompaniesManagementPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold">신규 회사 등록</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          필수 컬럼 입력 후 추가. 메타·재무·뉴스 보강은 별도로 onboard_company.py를 실행.
        </p>
      </div>
      <NewCompanyForm />

      <div className="border-border border-t pt-6">
        <h2 className="text-base font-semibold">회사 목록</h2>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">
          status=active 회사. 클라이언트 검색·필터로 중복 확인 + 신규 등록 전 사전 검증.
        </p>
        <Suspense fallback={<div className="text-muted-foreground text-xs">목록 로딩 중…</div>}>
          <CompanyListSection />
        </Suspense>
      </div>
    </div>
  );
}

async function CompanyListSection() {
  const companies = await getCompaniesList();
  return <CompanyList companies={companies} />;
}
