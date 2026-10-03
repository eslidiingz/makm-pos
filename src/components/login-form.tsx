'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import type { PlatformOwner } from '@/components/auth-boundary'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PhoneInput } from '@/components/ui/phone-input'
import { requiredField, useFormValidation } from '@/lib/form-validation'

const GENERIC_ERROR = 'เบอร์มือถือหรือรหัสผ่านไม่ถูกต้อง'

const SCHEMA = {
  password: requiredField('กรุณากรอกรหัสผ่าน'),
  phone: requiredField('กรุณากรอกเบอร์มือถือ'),
}

export function LoginForm() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const { fieldErrors, fieldProps, validate } = useFormValidation(SCHEMA)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    const form = new FormData(event.currentTarget)
    if (!validate({
      password: String(form.get('password') ?? ''),
      phone: String(form.get('phone') ?? ''),
    })) return

    setPending(true)
    try {
      const response = await fetch('/api/auth/login', {
        body: JSON.stringify({
          password: form.get('password'),
          phone: form.get('phone'),
        }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok) {
        setError(GENERIC_ERROR)
        return
      }

      const data = await response.json() as { user: PlatformOwner }
      router.replace(data.user.mustChangePassword ? '/change-password' : '/')
      router.refresh()
    } catch {
      setError('เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่อีกครั้ง')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="login-title">
        <div className="auth-brand">
          <span className="brand-mark">M</span>
          <div><p className="eyebrow">MAKM POS</p><strong>Platform Owner</strong></div>
        </div>
        <div className="auth-heading">
          <p className="auth-kicker">ยินดีต้อนรับกลับ</p>
          <h1 id="login-title">เข้าสู่ระบบจัดการร้าน</h1>
          <p>ใช้เบอร์มือถือและรหัสผ่านของ Platform Owner</p>
        </div>
        <form className="auth-form" noValidate onSubmit={submit}>
          <Label htmlFor="phone">เบอร์มือถือ</Label>
          <PhoneInput
            autoComplete="tel"
            autoFocus
            id="phone"
            name="phone"
            placeholder="08XXXXXXXX"
            required
            {...fieldProps('phone')}
          />
          <FieldError id="phone-error" message={fieldErrors.phone} />
          <Label htmlFor="password">รหัสผ่าน</Label>
          <Input
            autoComplete="current-password"
            id="password"
            maxLength={128}
            name="password"
            placeholder="กรอกรหัสผ่าน"
            required
            type="password"
            {...fieldProps('password')}
          />
          <FieldError id="password-error" message={fieldErrors.password} />
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <Button className="primary-button" disabled={pending} type="submit">
            {pending ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </Button>
        </form>
      </section>
      <aside className="auth-visual" aria-hidden="true">
        <div className="visual-copy"><p>OWNER CONTROL</p><h2>จัดการร้านได้ครบ<br />จากจุดเดียว</h2></div>
        <div className="visual-orb visual-orb-one" />
        <div className="visual-orb visual-orb-two" />
      </aside>
    </main>
  )
}
