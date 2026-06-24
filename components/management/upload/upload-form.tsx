'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import type { UploadStatus } from '@/lib/management/upload-schema';

type ScriptItem = { name: string; ok: boolean; exit_code: number; output: string };
type JobSummary = { ok: boolean; scripts: ScriptItem[]; warnings: string[] } | null;
type JobView = {
  id: string;
  status: UploadStatus;
  file_name: string;
  summary: JobSummary;
  error_msg: string | null;
};

const POLL_MS = 3000;
const TERMINAL: UploadStatus[] = ['dry_run_ok', 'dry_run_failed', 'applied', 'apply_failed'];

/** 단순 상태 폴링 훅 — jobId가 있으면 TERMINAL 상태에 도달할 때까지 주기적으로 GET. */
function useJobPoller(jobId: string | null, onUpdate: (v: JobView) => void) {
  const onUpdateRef = useRef(onUpdate);
  useLayoutEffect(() => {
    onUpdateRef.current = onUpdate;
  });

  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch(`/api/management/upload/${jobId}`, { cache: 'no-store' });
        const json = await res.json();
        if (cancelled) return;
        if (json.success) {
          const v = json.data as JobView;
          onUpdateRef.current(v);
          if (!TERMINAL.includes(v.status)) {
            timerId = setTimeout(tick, POLL_MS);
          }
        } else {
          timerId = setTimeout(tick, POLL_MS);
        }
      } catch {
        if (!cancelled) {
          timerId = setTimeout(tick, POLL_MS);
        }
      }
    }

    tick();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [jobId]);
}

export function ManagementExcelUploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [busy, setBusy] = useState(false);

  useJobPoller(jobId, (v) => setJob(v));

  const onUpload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/management/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json?.error?.message ?? '업로드 실패');
        return;
      }
      const id = json.data.job_id as string;
      setJob(null);
      setJobId(id);
      toast.success('업로드 완료. dry-run 검증을 시작합니다.');
    } finally {
      setBusy(false);
    }
  };

  const onApply = async () => {
    if (!jobId) return;
    const currentJobId = jobId;
    setBusy(true);
    try {
      const res = await fetch(`/api/management/upload/${currentJobId}/apply`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json?.error?.message ?? '적재 트리거 실패');
        return;
      }
      toast.success('적재를 시작합니다.');
      // useJobPoller를 재기동하기 위해 jobId를 초기화했다가 복원
      setJob(null);
      setJobId(null);
      setTimeout(() => setJobId(currentJobId), 0);
    } finally {
      setBusy(false);
    }
  };

  const status = job?.status;
  const inProgress = status === 'dry_run_running' || status === 'applying' || (!!jobId && !job);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <Button onClick={onUpload} disabled={!file || busy || inProgress}>
          업로드 + 검증
        </Button>
      </div>

      {inProgress && (
        <p className="text-sm text-muted-foreground">
          {status === 'applying' ? '적재 중…' : '검증 중…'} (수 분 소요, 자동 갱신)
        </p>
      )}

      {status === 'dry_run_failed' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">검증 실패</p>
          <p className="text-muted-foreground mt-1">{job?.error_msg}</p>
          <ScriptTable summary={job?.summary ?? null} />
        </div>
      )}

      {status === 'dry_run_ok' && (
        <div className="rounded-md border border-border p-3 text-sm space-y-3">
          <p className="font-medium">검증 완료 — 적재 준비됨</p>
          <WarningList summary={job?.summary ?? null} />
          <ScriptTable summary={job?.summary ?? null} />
          <Button onClick={onApply} disabled={busy}>
            적재 확정
          </Button>
        </div>
      )}

      {status === 'applied' && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium text-green-600">적재 완료</p>
          <p className="text-muted-foreground mt-1">페이지 데이터가 갱신되었습니다.</p>
        </div>
      )}

      {status === 'apply_failed' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">적재 실패</p>
          <p className="text-muted-foreground mt-1">{job?.error_msg}</p>
          <ScriptTable summary={job?.summary ?? null} />
        </div>
      )}
    </div>
  );
}

function WarningList({ summary }: { summary: JobSummary }) {
  if (!summary?.warnings?.length) return null;
  return (
    <ul className="list-disc pl-5 text-amber-600 text-xs space-y-0.5">
      {summary.warnings.map((w, i) => (
        <li key={i}>{w}</li>
      ))}
    </ul>
  );
}

function ScriptTable({ summary }: { summary: JobSummary }) {
  if (!summary?.scripts?.length) return null;
  return (
    <table className="w-full text-xs mt-2">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1">스크립트</th>
          <th className="py-1">결과</th>
        </tr>
      </thead>
      <tbody>
        {summary.scripts.map((s) => (
          <tr key={s.name} className="border-t border-border/50">
            <td className="py-1">{s.name}</td>
            <td className="py-1">{s.ok ? '✓ OK' : `✗ 실패(${s.exit_code})`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
