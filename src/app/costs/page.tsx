import { AuthBoundary } from '@/components/auth-boundary'
import { CostManager } from '@/components/cost-manager'

export default function CostsPage() {
  return <AuthBoundary><CostManager /></AuthBoundary>
}
