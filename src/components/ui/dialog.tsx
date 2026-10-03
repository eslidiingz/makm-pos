'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { type ComponentPropsWithoutRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { children: ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-dialog-overlay" />
      <DialogPrimitive.Content className={cn('ui-dialog-content', className)} {...props}>
        {children}
        <DialogPrimitive.Close aria-label="ปิด" className="ui-dialog-close">
          <X aria-hidden="true" size={18} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="ui-dialog-header">{children}</div>
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="ui-dialog-footer">{children}</div>
}

export function DialogTitle(props: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className="ui-dialog-title" {...props} />
}

export function DialogDescription(
  props: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>,
) {
  return <DialogPrimitive.Description className="ui-dialog-description" {...props} />
}
