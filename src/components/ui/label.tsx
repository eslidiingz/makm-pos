'use client'

import * as LabelPrimitive from '@radix-ui/react-label'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'

import { RequiredMark } from '@/components/ui/field-error'
import { cn } from '@/lib/utils'

export const Label = forwardRef<
  ElementRef<typeof LabelPrimitive.Root>,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(function Label({ children, className, required, ...props }, ref) {
  return (
    <LabelPrimitive.Root className={cn('ui-label', className)} ref={ref} {...props}>
      {children}
      {required ? <RequiredMark /> : null}
    </LabelPrimitive.Root>
  )
})
