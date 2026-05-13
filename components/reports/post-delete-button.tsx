'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface Props {
  postId: number;
  postTitle: string;
}

/**
 * 상세 페이지의 삭제 버튼. 확인 모달 후 DELETE → 목록으로 이동.
 */
export function PostDeleteButton({ postId, postTitle }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleDelete = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json?.error?.message ?? '게시글 삭제에 실패했습니다.');
        return;
      }
      toast.success('게시글을 삭제했습니다.');
      setOpen(false);
      router.push('/reports');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" />}>삭제</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>게시글을 삭제할까요?</DialogTitle>
          <DialogDescription>
            “{postTitle}” 글이 영구적으로 삭제됩니다. 이 동작은 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>취소</DialogClose>
          <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
            {submitting ? '삭제 중…' : '삭제하기'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
