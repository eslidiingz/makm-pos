import { forwardRef, type HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...props }, ref) {
    return <div className={cn('ui-card', className)} ref={ref} {...props} />
  },
)
