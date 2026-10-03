export const MIN_PASSWORD_LENGTH = 8

const THAI_LOCAL_MOBILE = /^0([689]\d{8})$/
const THAI_E164_MOBILE = /^\+66([689]\d{8})$/

export function normalizeThaiPhone(input: string): string | null {
  const compact = input.trim().replace(/[\s()-]/g, '')
  const localMatch = compact.match(THAI_LOCAL_MOBILE)
  if (localMatch) return `+66${localMatch[1]}`

  const e164Match = compact.match(THAI_E164_MOBILE)
  return e164Match ? `+66${e164Match[1]}` : null
}

export function validatePassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH && password.length <= 128
}
