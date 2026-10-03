'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { usePlatformOwner } from '@/components/auth-boundary'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requiredField, useFormValidation } from '@/lib/form-validation'

const MIN_PASSWORD_LENGTH = 8

const SCHEMA = {
  confirmation: (value: string, values: Partial<Record<string, string>>) => {
    if (!value) return 'กรุณายืนยันรหัสผ่านใหม่'
    return value === values.newPassword ? null : 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน'
  },
  currentPassword: requiredField('กรุณากรอกรหัสผ่านปัจจุบัน'),
  newPassword: (value: string) => {
    if (!value) return 'กรุณากรอกรหัสผ่านใหม่'
    return value.length >= MIN_PASSWORD_LENGTH ? null : `รหัสผ่านใหม่ต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัว`
  },
}

export function ChangePasswordForm() {
  const owner = usePlatformOwner()
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const passwordChangeRequired = owner.mustChangePassword
  const { fieldErrors, fieldProps, validate } = useFormValidation(SCHEMA)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const currentPassword = String(form.get('currentPassword') ?? '')
    const newPassword = String(form.get('newPassword') ?? '')
    const confirmation = String(form.get('confirmation') ?? '')

    if (!validate({ confirmation, currentPassword, newPassword })) return

    setPending(true)
    try {
      const response = await fetch('/api/auth/change-password', {
        body: JSON.stringify({ currentPassword, newPassword }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) {
        setError('เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาตรวจสอบรหัสเดิม')
        return
      }
      router.replace('/')
      router.refresh()
    } catch {
      setError('เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="auth-page auth-page-centered">
      <section className="auth-panel compact" aria-labelledby="change-password-title">
        {!passwordChangeRequired ? <Link className="back-link" href="/">← กลับแดชบอร์ด</Link> : null}
        <div className="auth-brand">
          <span className="brand-mark">M</span>
          <div><p className="eyebrow">ACCOUNT SECURITY</p><strong>MAKM POS</strong></div>
        </div>
        <div className="auth-heading">
          <p className="auth-kicker">{passwordChangeRequired ? 'เข้าสู่ระบบครั้งแรก' : 'ตั้งค่าบัญชี'}</p>
          <h1 id="change-password-title">{passwordChangeRequired ? 'ตั้งรหัสผ่านใหม่' : 'เปลี่ยนรหัสผ่าน'}</h1>
          <p>{passwordChangeRequired ? 'ต้องเปลี่ยนรหัสชั่วคราวก่อนเข้าใช้งานระบบ' : 'ตั้งรหัสผ่านใหม่เพื่อรักษาความปลอดภัยของบัญชี'}</p>
        </div>
        <form className="auth-form" noValidate onSubmit={submit}>
          <Label htmlFor="currentPassword" required>{passwordChangeRequired ? 'รหัสผ่านชั่วคราว' : 'รหัสผ่านปัจจุบัน'}</Label>
          <Input autoComplete="current-password" id="currentPassword" maxLength={128} name="currentPassword" placeholder="กรอกรหัสผ่าน" required type="password" {...fieldProps('currentPassword')} />
          <FieldError id="currentPassword-error" message={fieldErrors.currentPassword} />
          <Label htmlFor="newPassword" required>รหัสผ่านใหม่</Label>
          <Input autoComplete="new-password" id="newPassword" maxLength={128} name="newPassword" placeholder="กรอกรหัสผ่านใหม่" required type="password" {...fieldProps('newPassword')} />
          <FieldError id="newPassword-error" message={fieldErrors.newPassword} />
          <p className="field-hint">อย่างน้อย 8 ตัว{passwordChangeRequired ? ' และไม่ซ้ำรหัสชั่วคราว' : ''}</p>
          <Label htmlFor="confirmation" required>ยืนยันรหัสผ่านใหม่</Label>
          <Input autoComplete="new-password" id="confirmation" maxLength={128} name="confirmation" placeholder="กรอกรหัสผ่านใหม่อีกครั้ง" required type="password" {...fieldProps('confirmation')} />
          <FieldError id="confirmation-error" message={fieldErrors.confirmation} />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <Button className="primary-button" disabled={pending} type="submit">
            {pending ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
          </Button>
        </form>
      </section>
    </main>
  )
}
