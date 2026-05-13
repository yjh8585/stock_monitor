import { randomUUID } from 'node:crypto';

import logger from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

type CanvasFactory = (
  width: number,
  height: number
) => {
  getContext(type: '2d'): unknown;
  toBuffer(format: 'image/png'): Buffer;
};

const REPORTS_BUCKET = 'reports';
const RENDER_SCALE = 1.6;
const MAX_PAGES = 60;

interface PdfDocumentLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfPageLike {
  getViewport(opts: { scale: number }): PdfViewport;
  render(opts: { canvasContext: unknown; viewport: PdfViewport }): { promise: Promise<void> };
}

export interface PageImage {
  pageNumber: number;
  publicUrl: string;
}

/**
 * PDF 의 각 페이지를 PNG 로 렌더해 Supabase Storage 에 업로드하고
 * 페이지 번호 → 공개 URL 의 목록을 반환한다.
 * 60 페이지 초과 PDF 는 앞부분만 처리한다.
 */
export async function renderPdfPagesToStorage(
  pdfBuffer: Buffer,
  baseObjectPath: string
): Promise<PageImage[]> {
  const [createCanvas, pdfjs] = await Promise.all([loadCanvas(), loadPdfjs()]);
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) });
  const pdf = (await loadingTask.promise) as PdfDocumentLike;

  const totalPages = Math.min(pdf.numPages, MAX_PAGES);
  logger.info({ totalPages, declaredPages: pdf.numPages }, 'PDF 페이지 렌더 시작');

  const supabase = createSupabaseAdminClient();
  const folder = `${baseObjectPath}/pages-${randomUUID().slice(0, 8)}`;
  const results: PageImage[] = [];

  for (let n = 1; n <= totalPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;
    const png = canvas.toBuffer('image/png');

    const objectPath = `${folder}/page-${String(n).padStart(3, '0')}.png`;
    const { error } = await supabase.storage
      .from(REPORTS_BUCKET)
      .upload(objectPath, png, { contentType: 'image/png', upsert: false });

    if (error) {
      logger.warn({ err: error, page: n }, 'PDF 페이지 업로드 실패 — 건너뜀');
      continue;
    }

    const { data: pub } = supabase.storage.from(REPORTS_BUCKET).getPublicUrl(objectPath);
    results.push({ pageNumber: n, publicUrl: pub.publicUrl });
  }

  logger.info({ uploaded: results.length, totalPages }, 'PDF 페이지 렌더 완료');
  return results;
}

async function loadPdfjs(): Promise<{
  getDocument(opts: { data: Uint8Array }): { promise: Promise<unknown> };
}> {
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return mod as unknown as {
    getDocument(opts: { data: Uint8Array }): { promise: Promise<unknown> };
  };
}

async function loadCanvas(): Promise<CanvasFactory> {
  const mod = (await import('@napi-rs/canvas')) as unknown as { createCanvas: CanvasFactory };
  return mod.createCanvas;
}
