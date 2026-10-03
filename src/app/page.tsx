import { AuthBoundary } from '@/components/auth-boundary'
import { OwnerDashboard } from '@/components/owner-dashboard'

export default function Home() {
  return <AuthBoundary><OwnerDashboard /></AuthBoundary>
}
