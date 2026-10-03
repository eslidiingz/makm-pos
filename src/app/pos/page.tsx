import { AuthBoundary } from '@/components/auth-boundary'
import { PosScreen } from '@/components/pos-screen'

export default function PosPage() {
  return <AuthBoundary><PosScreen /></AuthBoundary>
}
