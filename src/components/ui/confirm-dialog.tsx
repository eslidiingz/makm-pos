'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function ConfirmDialog({
  cancelLabel = 'ยกเลิก',
  confirmLabel = 'ยืนยัน',
  description,
  error,
  onConfirm,
  onOpenChange,
  open,
  pending = false,
  title,
}: {
  cancelLabel?: string
  confirmLabel?: string
  description: string
  /**
   * A failure from the confirmed action. It renders inside the dialog because
   * the dialog stays open on failure, and a banner on the page behind it would
   * not be readable.
   */
  error?: string
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  pending?: boolean
  title: string
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">{cancelLabel}</Button>
          <Button disabled={pending} onClick={onConfirm} type="button" variant="danger">
            {pending ? 'กำลังดำเนินการ...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
