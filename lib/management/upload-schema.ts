import { z } from 'zod';

/** 업로드 작업 상태 머신. management_uploads.status CHECK와 일치. */
export const UPLOAD_STATUSES = [
  'uploaded',
  'dry_run_running',
  'dry_run_ok',
  'dry_run_failed',
  'applying',
  'applied',
  'apply_failed',
] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

/** GET 폴링 응답에 노출하는 작업 요약 (금액 비노출 — 행수/연도/경고만). */
export const uploadJobViewSchema = z.object({
  id: z.string(),
  status: z.enum(UPLOAD_STATUSES),
  file_name: z.string(),
  summary: z.unknown().nullable(),
  error_msg: z.string().nullable(),
});
export type UploadJobView = z.infer<typeof uploadJobViewSchema>;

export const MAX_XLSX_BYTES = 50 * 1024 * 1024; // 50MB
