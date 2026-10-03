import { forwardRef, type InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, required, ...props }, ref) {
    return (
      // `required` drives aria-required only. Forwarding the HTML attribute
      // would re-enable the browser's unstyled validation popover.
      <input
        aria-required={required ? true : undefined}
        className={cn('ui-input', className)}
        ref={ref}
        {...props}
      />
    )
  },
)
