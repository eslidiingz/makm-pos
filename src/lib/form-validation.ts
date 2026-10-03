'use client'

import { useCallback, useState } from 'react'

// Returns a Thai error message, or null when the value is acceptable.
export type FieldValidator = (
  value: string,
  values: Partial<Record<string, string>>,
) => null | string

export type FieldSchema<Field extends string> = Record<Field, FieldValidator>

export function requiredField(message: string): FieldValidator {
  return (value) => (value.trim() ? null : message)
}

/**
 * Submit-time validation for forms that read their values from FormData.
 *
 * Errors appear only after a submit attempt and clear per field as soon as the
 * user edits that field, so nobody is corrected mid-typing.
 */
export function useFormValidation<Field extends string>(schema: FieldSchema<Field>) {
  // Callers pass a module-level schema constant, so its identity is stable.
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({})

  const clearField = useCallback((field: Field) => {
    setFieldErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }, [])

  const validate = useCallback((values: Partial<Record<Field, string>>) => {
    const next: Partial<Record<Field, string>> = {}
    for (const field of Object.keys(schema) as Field[]) {
      const message = schema[field](
        values[field] ?? '',
        values as Partial<Record<string, string>>,
      )
      if (message) next[field] = message
    }
    setFieldErrors(next)
    return Object.keys(next).length === 0
  }, [schema])

  // Spread onto an input to wire its accessible error relationship.
  const fieldProps = useCallback((field: Field) => ({
    'aria-describedby': fieldErrors[field] ? `${field}-error` : undefined,
    'aria-invalid': fieldErrors[field] ? true : undefined,
    onChange: () => clearField(field),
  }), [clearField, fieldErrors])

  return { clearField, fieldErrors, fieldProps, validate }
}
