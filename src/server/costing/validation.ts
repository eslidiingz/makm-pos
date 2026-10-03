import { INGREDIENT_UNITS, type IngredientUnit, type RecipeItemInput } from '@/server/costing/types'

/**
 * Input validation only. Not one baht is added, multiplied or divided here:
 * SQL numeric is the single authority for every cost, average and margin, so
 * a rounding rule can never fork between the database and the API.
 */

export const MAX_PURCHASE_QUANTITY = 1_000_000
export const MAX_PURCHASE_COST = 9_999_999.99
export const MAX_RECIPE_ITEMS = 40
export const MAX_BATCH_YIELD = 100_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * A quantity of 0.00005 kg would round to 0.0000 in numeric(14,4) and price the
 * whole recipe from nothing, so extra decimals are rejected rather than stored.
 * Exponent notation ('1e-7') is rejected for the same reason.
 */
function hasAtMostDecimals(value: number, places: number) {
  const text = String(value)
  if (text.includes('e') || text.includes('E')) return false

  const point = text.indexOf('.')
  return point === -1 || text.length - point - 1 <= places
}

export function isIngredientUnit(value: string): value is IngredientUnit {
  return (INGREDIENT_UNITS as readonly string[]).includes(value)
}

export function normalizeIngredientName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function isValidIngredientName(value: string) {
  const normalized = normalizeIngredientName(value)
  return normalized.length >= 1 && normalized.length <= 80
}

export function normalizePurchaseNote(value: string | null) {
  if (value === null) return null

  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function isValidPurchaseNote(value: string | null) {
  if (value === null) return true

  const trimmed = value.trim()
  return trimmed.length >= 1 && trimmed.length <= 160
}

/** Zero is rejected explicitly: Elysia's t.Number({ minimum: 0 }) accepts it. */
export function isValidPurchaseQuantity(value: number) {
  return Number.isFinite(value)
    && value > 0
    && value <= MAX_PURCHASE_QUANTITY
    && hasAtMostDecimals(value, 4)
}

export function isValidPurchaseCost(value: number) {
  return Number.isFinite(value)
    && value >= 0
    && value <= MAX_PURCHASE_COST
    && hasAtMostDecimals(value, 2)
}

export function isValidBatchQuantity(value: number) {
  return Number.isFinite(value)
    && value > 0
    && value <= MAX_PURCHASE_QUANTITY
    && hasAtMostDecimals(value, 4)
}

/**
 * The yield stays an integer count of skewers. Storing a pre-divided decimal
 * would turn a yield of 3 into 0.333333 and lose the exact ratio the owner
 * typed.
 */
export function isValidBatchYield(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_BATCH_YIELD
}

/**
 * A recipe must name each ingredient at most once, otherwise the same
 * ingredient would be counted twice in the product's unit cost.
 *
 * Note: an empty array is rejected here. public.set_product_recipe accepts 0
 * lines so a recipe can be cleared, so a route that supports clearing must
 * treat the empty array as its own case before calling this.
 */
export function isValidRecipeItems(items: RecipeItemInput[]) {
  if (!items.length || items.length > MAX_RECIPE_ITEMS) return false

  const ingredientIds = new Set<string>()

  for (const item of items) {
    if (
      !UUID.test(item.ingredientId)
      || ingredientIds.has(item.ingredientId)
      || !isValidBatchQuantity(item.batchQuantity)
      || !isValidBatchYield(item.batchYield)
    ) return false
    ingredientIds.add(item.ingredientId)
  }

  return true
}

export function isValidPurchasePage(page: number, pageSize: number) {
  return Number.isInteger(page)
    && page >= 1
    && page <= 100_000
    && Number.isInteger(pageSize)
    && pageSize >= 1
    && pageSize <= 100
}
