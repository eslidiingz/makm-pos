import { cn } from '@/lib/utils'

// Renders nothing until the field actually has an error, so callers can drop it
// in unconditionally next to the input it describes.
export function FieldError({
  className,
  id,
  message,
}: {
  className?: string
  id: string
  message?: string
}) {
  if (!message) return null
  return <p className={cn('field-error', className)} id={id} role="alert">{message}</p>
}

export function RequiredMark() {
  // The field already carries aria-required; announcing "asterisk" on top of
  // that is noise, so this stays visual-only.
  return <span aria-hidden="true" className="required-mark">*</span>
}
