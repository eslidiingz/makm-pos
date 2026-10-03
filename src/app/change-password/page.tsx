import { AuthBoundary } from '@/components/auth-boundary'
import { ChangePasswordForm } from '@/components/change-password-form'

export default function ChangePasswordPage() {
  return (
    <AuthBoundary allowPasswordChange>
      <ChangePasswordForm />
    </AuthBoundary>
  )
}
