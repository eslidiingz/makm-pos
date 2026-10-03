import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Cookie } from 'elysia'

import { AUTH_COOKIE_NAMES } from '@/lib/auth-constants'
import type { AuthSession } from '@/server/auth/types'

export { AUTH_COOKIE_NAMES }

export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000

type AuthCookieJar = Record<string, Cookie<unknown>>

function getCookieSecret() {
  const secret = process.env.AUTH_COOKIE_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_COOKIE_SECRET must contain at least 32 characters.')
  }
  return secret
}

function signatureFor(value: string) {
  return createHmac('sha256', getCookieSecret()).update(value).digest('base64url')
}

export function signSessionStart(startedAt: number): string {
  const value = String(startedAt)
  return `${value}.${signatureFor(value)}`
}

export function verifySessionStart(signedValue: string | undefined): number | null {
  if (!signedValue) return null
  const separator = signedValue.lastIndexOf('.')
  if (separator < 1) return null

  const value = signedValue.slice(0, separator)
  const signature = signedValue.slice(separator + 1)
  const startedAt = Number(value)
  if (!Number.isSafeInteger(startedAt) || startedAt <= 0) return null

  const expected = signatureFor(value)
  const expectedBuffer = Buffer.from(expected)
  const signatureBuffer = Buffer.from(signature)
  if (
    expectedBuffer.length !== signatureBuffer.length
    || !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) return null

  return startedAt
}

export function sessionRemainingSeconds(startedAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((startedAt + SESSION_MAX_AGE_MS - now) / 1000))
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: '/',
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
  }
}

export function setAuthCookies(
  cookies: AuthCookieJar,
  session: AuthSession,
  startedAt = Date.now(),
  now = Date.now(),
) {
  const remaining = sessionRemainingSeconds(startedAt, now)
  if (remaining <= 0) {
    clearAuthCookies(cookies)
    return false
  }

  const accessMaxAge = Math.max(1, Math.min(session.expiresIn, remaining))
  cookies[AUTH_COOKIE_NAMES.access].set({
    ...cookieOptions(accessMaxAge),
    value: session.accessToken,
  })
  cookies[AUTH_COOKIE_NAMES.refresh].set({
    ...cookieOptions(remaining),
    value: session.refreshToken,
  })
  cookies[AUTH_COOKIE_NAMES.startedAt].set({
    ...cookieOptions(remaining),
    value: signSessionStart(startedAt),
  })
  return true
}

export function clearAuthCookies(cookies: AuthCookieJar) {
  for (const name of Object.values(AUTH_COOKIE_NAMES)) {
    cookies[name].set({
      ...cookieOptions(0),
      expires: new Date(0),
      value: '',
    })
  }
}

export function readAuthCookies(cookies: AuthCookieJar) {
  return {
    accessToken: typeof cookies[AUTH_COOKIE_NAMES.access].value === 'string'
      ? cookies[AUTH_COOKIE_NAMES.access].value as string
      : undefined,
    refreshToken: typeof cookies[AUTH_COOKIE_NAMES.refresh].value === 'string'
      ? cookies[AUTH_COOKIE_NAMES.refresh].value as string
      : undefined,
    signedStartedAt: typeof cookies[AUTH_COOKIE_NAMES.startedAt].value === 'string'
      ? cookies[AUTH_COOKIE_NAMES.startedAt].value as string
      : undefined,
  }
}
