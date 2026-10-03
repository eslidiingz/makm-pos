import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva('ui-button', {
  defaultVariants: { size: 'default', variant: 'primary' },
  variants: {
    size: {
      default: 'ui-button-default',
      icon: 'ui-button-icon',
      small: 'ui-button-small',
    },
    variant: {
      danger: 'ui-button-danger',
      ghost: 'ui-button-ghost',
      primary: 'ui-button-primary',
      secondary: 'ui-button-secondary',
    },
  },
})

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>
  & VariantProps<typeof buttonVariants>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, size, variant, ...props },
  ref,
) {
  return <button className={cn(buttonVariants({ size, variant }), className)} ref={ref} {...props} />
})
