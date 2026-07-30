'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileSpreadsheet, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import type { UploadStatus } from '@/lib/management/upload-schema';

type ScriptItem = { name: string; ok: boolean; exit_code: number };
type JobSummary = { ok: boolean; scripts: ScriptItem[]; warnings: string[] } | null;
type JobView = {
  id: string;
  status: UploadStatus;
  file_name: string;
  summary: JobSummary;
  error_msg: string | null;
};

/** 폴링 단계 — dry-run 검증 중인지, 적재 중인지에 따라 종료 상태가 다르다. */
type Phase = 'idle' | 'dry' | 'apply';

const POLL_MS = 3000;
const TERMINAL_DRY: UploadStatus[] = ['dry_run_ok', 'dry_run_failed'];
const TERMINAL_APPLY: UploadStatus[] = ['applied', 'apply_failed'];

/**
 * jobId를 phase에 맞는 종료 상태까지 폴링.
 *
 * phase가 'dry'→'apply'로 바뀌면 effect가 재실행되어 폴링이 다시 시작된다(같은 jobId).
 * 종료 상태를 phase별로 구분하므로, 적재 단계에서 dry_run_ok를 종료로 오인해
 * 폴링이 멈추는 일이 없다.
 */
function useJobPoller(jobId: string | null, phase: Phase, onUpdate: (v: JobView) => void) {
  const onUpdateRef = useRef(onUpdate);
  useLayoutEffect(() => {
    onUpdateRef.current = onUpdate;
  });

  useEffect(() => {
    if (!jobId || phase === 'idle') return;
    const terminal = phase === 'apply' ? TERMINAL_APPLY : TERMINAL_DRY;

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
          if (!terminal.includes(v.status)) {
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
  }, [jobId, phase]);
}

export function ManagementExcelUploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  useJobPoller(jobId, phase, (v) => setJob(v));

  const pickFile = (picked: File | null) => {
    setPickError(null);
    setFile(picked);
  };

  /** 드롭된 파일 수락 — 드래그&드롭은 input accept가 적용되지 않아 확장자를 직접 확인한다. */
  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    if (!dropped.name.toLowerCase().endsWith('.xlsx')) {
      setPickError(`.xlsx 엑셀 파일만 올릴 수 있습니다 (올린 파일: ${dropped.name}).`);
      return;
    }
    pickFile(dropped);
  };

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
      setPhase('dry');
      toast.success('업로드 완료. dry-run 검증을 시작합니다.');
    } finally {
      setBusy(false);
    }
  };

  const onApply = async () => {
    if (!jobId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/management/upload/${jobId}/apply`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json?.error?.message ?? '적재 트리거 실패');
        return;
      }
      toast.success('적재를 시작합니다.');
      // 낙관적으로 '적재 중'을 즉시 표시하고, phase 전환으로 폴링을 재시작한다.
      setJob((j) => (j ? { ...j, status: 'applying' } : j));
      setPhase('apply');
    } finally {
      setBusy(false);
    }
  };

  const status = job?.status;
  const inProgress = status === 'dry_run_running' || status === 'applying' || (!!jobId && !job);

  return (
    <div className="space-y-4">
      {/* 클릭 영역을 박스 전체로 넓힌 파일 선택 드롭존 (label이 숨긴 input을 감싼다) */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring ${
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/60'
        }`}
      >
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          className="sr-only"
        />
        {file ? (
          <>
            <FileSpreadsheet className="size-7 text-primary" aria-hidden />
            <span className="text-sm font-medium break-all">{file.name}</span>
            <span className="text-muted-foreground text-xs">
              다른 파일로 바꾸려면 이 영역을 다시 클릭하세요.
            </span>
          </>
        ) : (
          <>
            <UploadCloud className="text-muted-foreground size-7" aria-hidden />
            <span className="text-sm font-medium">여기를 클릭해서 엑셀 파일을 선택하세요</span>
            <span className="text-muted-foreground text-xs">
              또는 파일을 이 영역에 끌어다 놓으세요 · .xlsx 형식만
            </span>
          </>
        )}
      </label>

      {pickError && (
        <p role="alert" className="text-destructive text-sm">
          {pickError}
        </p>
      )}

      <Button onClick={onUpload} disabled={!file || busy || inProgress}>
        업로드 + 검증
      </Button>

      {inProgress && (
        <p className="text-sm text-muted-foreground">
          {status === 'applying' || phase === 'apply' ? '적재 중…' : '검증 중…'} (수 분 소요, 자동
          갱신)
        </p>
      )}

      {status === 'dry_run_failed' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="text-destructive font-medium">검증 실패</p>
          <p className="text-muted-foreground mt-1">{job?.error_msg}</p>
          <ScriptTable summary={job?.summary ?? null} />
        </div>
      )}

      {status === 'dry_run_ok' && (
        <div className="border-border space-y-3 rounded-md border p-3 text-sm">
          <p className="font-medium">검증 완료 — 적재 준비됨</p>
          <WarningList summary={job?.summary ?? null} />
          <ScriptTable summary={job?.summary ?? null} />
          <Button onClick={onApply} disabled={busy}>
            적재 확정
          </Button>
        </div>
      )}

      {status === 'applied' && (
        <div className="border-border rounded-md border p-3 text-sm">
          <p className="font-medium text-green-600">적재 완료</p>
          <p className="text-muted-foreground mt-1">페이지 데이터가 갱신되었습니다.</p>
        </div>
      )}

      {status === 'apply_failed' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="text-destructive font-medium">적재 실패</p>
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
    <ul className="list-disc pl-5 text-xs text-amber-600 space-y-0.5">
      {summary.warnings.map((w, i) => (
        <li key={i}>{w}</li>
      ))}
    </ul>
  );
}

function ScriptTable({ summary }: { summary: JobSummary }) {
  if (!summary?.scripts?.length) return null;
  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="text-muted-foreground text-left">
          <th className="py-1">스크립트</th>
          <th className="py-1">결과</th>
        </tr>
      </thead>
      <tbody>
        {summary.scripts.map((s) => (
          <tr key={s.name} className="border-border/50 border-t">
            <td className="py-1">{s.name}</td>
            <td className="py-1">{s.ok ? '✓ OK' : `✗ 실패(${s.exit_code})`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
