export type ApiErrorPayload = {
  code?: string
  message?: string
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const request = () => fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
    headers: init?.body
      ? { 'Content-Type': 'application/json', ...init.headers }
      : init?.headers,
  })

  let response = await request()
  if (response.status === 401 && url !== '/api/auth/me') {
    const session = await fetch('/api/auth/me', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (session.ok) response = await request()
  }

  const data = await response.json().catch(() => ({})) as T & ApiErrorPayload
  if (!response.ok) {
    throw new ApiRequestError(
      data.message || 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่',
      response.status,
      data.code,
    )
  }
  return data
}
