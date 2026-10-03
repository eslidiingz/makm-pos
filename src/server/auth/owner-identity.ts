import { normalizeThaiPhone } from '@/server/auth/validation'

type OwnerIdentityConfiguration = {
  authEmail?: string
  phone?: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeStoredPhone(phone: string) {
  return phone.startsWith('66') ? `+${phone}` : phone
}

export function resolveOwnerAuthEmail(
  phone: string,
  configuration: OwnerIdentityConfiguration = {
    authEmail: process.env.PLATFORM_OWNER_AUTH_EMAIL,
    phone: process.env.PLATFORM_OWNER_PHONE,
  },
) {
  if (!configuration.phone || !configuration.authEmail) {
    throw new Error('Missing Platform Owner authentication identity configuration.')
  }

  const configuredPhone = normalizeThaiPhone(configuration.phone)
  const requestedPhone = normalizeThaiPhone(normalizeStoredPhone(phone))
  const authEmail = configuration.authEmail.trim().toLowerCase()

  if (!configuredPhone || !EMAIL_PATTERN.test(authEmail)) {
    throw new Error('Invalid Platform Owner authentication identity configuration.')
  }

  return requestedPhone === configuredPhone ? authEmail : null
}
