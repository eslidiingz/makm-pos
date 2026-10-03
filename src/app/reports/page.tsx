import { AuthBoundary } from '@/components/auth-boundary'
import { SalesReport } from '@/components/sales-report'

export default function ReportsPage() {
  return <AuthBoundary><SalesReport /></AuthBoundary>
}
