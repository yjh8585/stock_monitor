'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CreatePostInput } from '@/lib/reports/dto/post.dto';

type Tab = 'youtube' | 'report-web' | 'report-file';

export function NewPostForm() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('youtube');
  const [submitting, setSubmitting] = useState(false);

  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [reportWebUrl, setReportWebUrl] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    try {
      const payload = await buildPayload();
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        const message = json?.error?.message ?? '게시글 생성에 실패했습니다.';
        toast.error(message);
        return;
      }
      toast.success('게시글이 등록되었습니다. 본문을 생성 중이에요.');
      router.push(`/reports/${json.data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const buildPayload = async (): Promise<CreatePostInput> => {
    if (tab === 'youtube') {
      if (!youtubeUrl.trim()) throw new Error('유튜브 URL 을 입력하세요.');
      return { kind: 'youtube', source_url: youtubeUrl.trim() };
    }
    if (tab === 'report-web') {
      if (!reportWebUrl.trim()) throw new Error('보고서 페이지 URL 을 입력하세요.');
      return { kind: 'report-web', source_url: reportWebUrl.trim() };
    }
    if (!pdfFile) throw new Error('PDF 파일을 선택하세요.');
    if (pdfFile.type !== 'application/pdf') throw new Error('PDF 파일만 업로드할 수 있습니다.');

    const fd = new FormData();
    fd.append('file', pdfFile);
    const uploadRes = await fetch('/api/uploads/report', { method: 'POST', body: fd });
    const uploadJson = await uploadRes.json();
    if (!uploadRes.ok || !uploadJson.success) {
      throw new Error(uploadJson?.error?.message ?? '파일 업로드 실패');
    }
    return {
      kind: 'report-file',
      file_path: uploadJson.data.file_path,
      file_name: uploadJson.data.file_name,
    };
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="youtube">유튜브 URL</TabsTrigger>
          <TabsTrigger value="report-web">보고서 웹페이지 URL</TabsTrigger>
          <TabsTrigger value="report-file">보고서 파일 직접 업로드</TabsTrigger>
        </TabsList>

        <TabsContent value="youtube" className="space-y-2 pt-4">
          <Label htmlFor="youtube-url">유튜브 영상 URL</Label>
          <Input
            id="youtube-url"
            type="url"
            placeholder="https://www.youtube.com/watch?v=..."
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
          />
          <p className="text-muted-foreground text-sm">
            Gemini 가 영상 전체의 자막을 추출해 한국어 본문으로 풀어 씁니다. 무료 티어 한도(분당
            25만 토큰) 때문에 매우 긴 영상은 실패할 수 있어요. 처음에는{' '}
            <span className="font-medium">10분 이내 영상</span>으로 테스트해 보세요.
          </p>
        </TabsContent>

        <TabsContent value="report-web" className="space-y-2 pt-4">
          <Label htmlFor="report-url">보고서 웹페이지 URL</Label>
          <Input
            id="report-url"
            type="url"
            placeholder="https://www.example.org/report"
            value={reportWebUrl}
            onChange={(e) => setReportWebUrl(e.target.value)}
          />
          <p className="text-muted-foreground text-sm">
            페이지 본문을 추출하고 PDF 첨부가 있으면 자동으로 함께 분석합니다.
          </p>
        </TabsContent>

        <TabsContent value="report-file" className="space-y-2 pt-4">
          <Label htmlFor="report-file">PDF 파일</Label>
          <Input
            id="report-file"
            type="file"
            accept="application/pdf"
            onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-muted-foreground text-sm">100MB 이하 PDF 만 업로드 가능합니다.</p>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? '등록 중…' : '게시글 등록'}
        </Button>
      </div>
    </form>
  );
}
