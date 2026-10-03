'use client'

import { forwardRef, useState, type InputHTMLAttributes } from 'react'

import { Input } from '@/components/ui/input'

// Thai mobile numbers normalize to ten local digits (0[689] plus eight more),
// matching normalizeThaiPhone on the server.
const MAX_PHONE_DIGITS = 10

// Sanitize before slicing so a pasted "081-234-5678" keeps all ten digits
// instead of losing the tail to a raw-character cap.
function toDigits(raw: string) {
  return raw.replace(/\D/g, '').slice(0, MAX_PHONE_DIGITS)
}

type PhoneInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'inputMode' | 'type' | 'value'
>

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput({ defaultValue, maxLength, onChange, ...props }, ref) {
    const [value, setValue] = useState(() => toDigits(String(defaultValue ?? '')))

    return (
      <Input
        {...props}
        inputMode="tel"
        // Backup only; toDigits owns the real cap.
        maxLength={maxLength ?? MAX_PHONE_DIGITS * 3}
        onChange={(event) => {
          setValue(toDigits(event.target.value))
          onChange?.(event)
        }}
        ref={ref}
        type="tel"
        value={value}
      />
    )
  },
)
