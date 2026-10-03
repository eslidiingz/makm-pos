'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

type AccountMenuProps = {
  avatarLabel: string
  loggingOut?: boolean
  name: string
  onLogout: () => void
  role: string
}

export function AccountMenu({
  avatarLabel,
  loggingOut = false,
  name,
  onLogout,
  role,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const passwordLinkRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (!open) return

    passwordLinkRef.current?.focus()

    function closeOnOutsidePress(event: PointerEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="account-menu" ref={menuRef}>
      <Button
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={`เปิดเมนูบัญชีของ ${name}`}
        className="account-avatar"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        ref={triggerRef}
        size="icon"
        type="button"
        variant="secondary"
      >
        <span aria-hidden="true">{avatarLabel}</span>
      </Button>

      {open ? (
        <div aria-label="เมนูบัญชี" className="account-dropdown" id={menuId}>
          <div className="account-dropdown-identity">
            <strong>{name}</strong>
            <span>{role}</span>
          </div>
          <div className="account-dropdown-actions">
            <Link
              className="account-dropdown-item"
              href="/change-password"
              onClick={() => setOpen(false)}
              ref={passwordLinkRef}
            >
              เปลี่ยนรหัสผ่าน
            </Link>
            <Button
              className="account-dropdown-logout"
              disabled={loggingOut}
              onClick={() => {
                setOpen(false)
                onLogout()
              }}
              type="button"
              variant="ghost"
            >
              {loggingOut ? 'กำลังออก...' : 'ออกจากระบบ'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
