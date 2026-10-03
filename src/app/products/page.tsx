import { AuthBoundary } from '@/components/auth-boundary'
import { CatalogManager } from '@/components/catalog-manager'

export default function ProductsPage() {
  return <AuthBoundary><CatalogManager /></AuthBoundary>
}
