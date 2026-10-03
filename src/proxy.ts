import { NextResponse, type NextRequest } from 'next/server'

import { AUTH_COOKIE_NAMES } from '@/lib/auth-constants'

export function proxy(request: NextRequest) {
  const hasAccessToken = request.cookies.has(AUTH_COOKIE_NAMES.access)
  const hasRefreshToken = request.cookies.has(AUTH_COOKIE_NAMES.refresh)

  if (!hasAccessToken && !hasRefreshToken) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/pos/:path*',
    '/products/:path*',
    '/reports/:path*',
    '/costs/:path*',
    '/change-password',
  ],
}
