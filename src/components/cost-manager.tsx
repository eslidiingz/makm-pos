'use client'

import { CheckCircle2, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { CostIngredients } from '@/components/cost-ingredients'
import { CostPurchases } from '@/components/cost-purchases'
import { CostRecipes } from '@/components/cost-recipes'
import { Button } from '@/components/ui/button'
import { requestJson } from '@/lib/api-client'
import type { CostingOverview, ProductCosting } from '@/server/costing/types'

type CostPanel = 'ingredients' | 'purchases' | 'recipes'

const PANEL_OPTIONS: Array<{ label: string; value: CostPanel }> = [
  { label: 'วัตถุดิบ', value: 'ingredients' },
  { label: 'การซื้อ', value: 'purchases' },
  { label: 'สูตรและกำไร', value: 'recipes' },
]

const EMPTY_OVERVIEW: CostingOverview = { ingredients: [], products: [] }

/**
 * Owns the /costs shell: one overview load shared by all three panels, one red
 * alert, one success flash. Panels never render a banner of their own so the
 * page keeps a single place where the owner looks for the result of an action.
 */
export function CostManager() {
  const [error, setError] = useState('')
  const [flash, setFlash] = useState<null | { id: number; message: string }>(null)
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<CostingOverview>(EMPTY_OVERVIEW)
  const [panel, setPanel] = useState<CostPanel>('ingredients')
  const requestVersion = useRef(0)

  const load = useCallback(async (options?: { signal?: AbortSignal; silent?: boolean }) => {
    const version = ++requestVersion.current
    if (!options?.silent) setLoading(true)
    try {
      const next = await requestJson<CostingOverview>(
        '/api/admin/costs/overview',
        { signal: options?.signal },
      )
      if (version === requestVersion.current) {
        setOverview(next)
        setError('')
      }
    } catch (requestError) {
      if (
        version === requestVersion.current
        && (requestError as Error).name !== 'AbortError'
      ) {
        setError(requestError instanceof Error ? requestError.message : 'โหลดข้อมูลต้นทุนไม่สำเร็จ')
      }
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [])

  // A mutation already shows its own pending state, so refreshing the shared
  // overview behind it must not blank the panel the owner is looking at.
  const refresh = useCallback(() => load({ silent: true }), [load])

  const notifyError = useCallback((message: string) => {
    setFlash(null)
    setError(message)
  }, [])

  const notifySuccess = useCallback((message: string) => {
    // The error banner belongs to `load`, which clears it on a successful
    // refresh. Clearing it here too would hide a refresh that failed right
    // after the mutation succeeded, leaving stale figures under a green flash.
    setFlash({ id: Date.now(), message })
  }, [])

  const applyProduct = useCallback((product: ProductCosting) => {
    setOverview((current) => ({
      ...current,
      products: current.products.map((item) => item.id === product.id ? product : item),
    }))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => void load({ signal: controller.signal }), 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [load])

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 6000)
    return () => window.clearTimeout(timer)
  }, [flash])

  const empty = !overview.ingredients.length && !overview.products.length

  return (
    <main className="cost-page">
      <header className="cost-header">
        <div>
          <Link className="back-link" href="/"><ChevronLeft size={16} /> กลับแดชบอร์ด</Link>
          <p className="eyebrow">COST &amp; PROFIT</p>
          <h1>ต้นทุนและกำไร</h1>
          <p>บันทึกราคาวัตถุดิบและสูตรต่อไม้ เพื่อดูต้นทุนจริงและกำไรของแต่ละเมนู</p>
        </div>
        <div aria-label="เลือกหัวข้อต้นทุน" className="report-periods cost-panel-switch" role="group">
          {PANEL_OPTIONS.map((option) => (
            <Button
              aria-pressed={panel === option.value}
              className={panel === option.value ? 'active' : ''}
              key={option.value}
              onClick={() => setPanel(option.value)}
              size="small"
              type="button"
              variant="ghost"
            >
              {option.label}
            </Button>
          ))}
        </div>
      </header>

      {error ? (
        <div className="catalog-alert cost-alert" role="alert">
          <span>{error}</span>
          <Button onClick={() => void load()} size="small" variant="ghost">ลองใหม่</Button>
        </div>
      ) : null}

      {flash ? (
        <div className="cost-flash" role="status">
          <CheckCircle2 aria-hidden="true" size={16} />
          <span>{flash.message}</span>
        </div>
      ) : null}

      {loading && empty ? (
        <section className="cost-panel">
          <div className="cost-state"><div className="auth-loader" /><p>กำลังโหลดข้อมูลต้นทุน...</p></div>
        </section>
      ) : panel === 'ingredients' ? (
        <CostIngredients
          ingredients={overview.ingredients}
          onError={notifyError}
          onSuccess={notifySuccess}
          reload={refresh}
        />
      ) : panel === 'purchases' ? (
        <CostPurchases
          ingredients={overview.ingredients}
          onError={notifyError}
          onSuccess={notifySuccess}
          reload={refresh}
        />
      ) : (
        <CostRecipes
          ingredients={overview.ingredients}
          onError={notifyError}
          onProductSaved={applyProduct}
          onSuccess={notifySuccess}
          products={overview.products}
          reload={refresh}
        />
      )}
    </main>
  )
}
