import { ManagementExcelUploadForm } from '@/components/management/upload/upload-form';

export const metadata = {
  title: '자료 업로드 — 경영관리',
};

/**
 * 월별손익 엑셀 업로드 → dry-run 검증 → 확인 후 적재. admin 전용(permissions ADMIN_ONLY_PATHS).
 * 실제 적재는 GitHub Actions(sync-management.yml)에서 8개 sync 실행.
 */
export default function ManagementUploadPage() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h2 className="text-base font-semibold">월별손익 엑셀 업로드</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          자료정리_월별손익 엑셀을 올리면 8개 사외비
          데이터(손익·계획·재고·인원·비용비율·고정비·재무·대여금)를 자동 적재합니다. 먼저
          dry-run으로 검증 요약을 확인한 뒤 적재를 확정하세요. 적재까지 수 분 소요됩니다.
        </p>
      </div>
      <ManagementExcelUploadForm />
    </div>
  );
}
