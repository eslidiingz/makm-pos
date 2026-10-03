'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'

export type PlatformOwner = {
  id: string
  mustChangePassword: boolean
  phone: string
  role: 'platform_owner'
}

const OwnerContext = createContext<PlatformOwner | null>(null)

export function usePlatformOwner() {
  const owner = useContext(OwnerContext)
  if (!owner) throw new Error('usePlatformOwner must be used inside AuthBoundary.')
  return owner
}

export function AuthBoundary({
  allowPasswordChange = false,
  children,
}: {
  allowPasswordChange?: boolean
  children: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [owner, setOwner] = useState<PlatformOwner | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    async function verify() {
      try {
        const response = await fetch('/api/auth/me', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (response.status === 401) {
          router.replace('/login')
          return
        }
        if (!response.ok) throw new Error('Unable to verify session.')

        const data = await response.json() as { user: PlatformOwner }
        if (data.user.mustChangePassword && !allowPasswordChange) {
          router.replace('/change-password')
          return
        }
        setOwner(data.user)
      } catch (requestError) {
        if ((requestError as Error).name !== 'AbortError') setError(true)
      }
    }

    void verify()
    return () => controller.abort()
  }, [allowPasswordChange, pathname, router])

  if (error) {
    return (
      <main className="auth-state">
        <div className="auth-state-card">
          <span className="brand-mark">M</span>
          <h1>เชื่อมต่อระบบไม่ได้</h1>
          <p>กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง</p>
          <Button className="primary-button" onClick={() => window.location.reload()}>
            ลองใหม่
          </Button>
        </div>
      </main>
    )
  }

  if (!owner) {
    return (
      <main className="auth-state" aria-live="polite">
        <div className="auth-loader" />
        <p>กำลังตรวจสอบสิทธิ์...</p>
      </main>
    )
  }

  return <OwnerContext.Provider value={owner}>{children}</OwnerContext.Provider>
}
