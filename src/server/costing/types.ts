import type { SalesPeriod } from '@/server/orders/types'

/**
 * Costing model
 *
 * An ingredient is bought in lots. Its cost per unit is the weighted average
 * across every lot ever recorded: sum(total_cost) / sum(quantity). It is null
 * until the first lot exists - never zero, because an unknown cost that reads
 * as zero would report the shop's margin as 100%.
 *
 * A product's recipe stores what the owner actually typed as a ratio rather
 * than a pre-divided decimal: `batchQuantity` of an ingredient yields
 * `batchYield` skewers. "1 kg makes 20 skewers" is 1 / 20 and "0.05 kg per
 * skewer" is 0.05 / 1, so a yield of 3 stays exact instead of becoming
 * 0.333333. Every cost is derived in SQL numeric from that pair; nothing in
 * TypeScript multiplies or divides money.
 *
 * Cost of goods sold is computed at read time from the current average, not
 * snapshotted when the sale happens. The shop logs its purchases in the
 * evening, after the day's sales, so a sale-time snapshot would freeze a cost
 * that predates the very purchase it is meant to account for. The consequence
 * is deliberate and documented for the owner: entering a purchase restates the
 * periods that sold that ingredient.
 */

export type IngredientUnit = 'g' | 'kg' | 'l' | 'ml' | 'pack' | 'piece'

export const INGREDIENT_UNITS: readonly IngredientUnit[] = [
  'kg',
  'g',
  'l',
  'ml',
  'pack',
  'piece',
]

export type Ingredient = {
  archivedAt: string | null
  /** Weighted average across every lot. Null until the first lot is recorded. */
  averageUnitCost: number | null
  id: string
  lastPurchasedOn: string | null
  name: string
  purchaseCount: number
  /** Recipes on products that are still on the menu, so the count matches the recipe list. */
  recipeProductCount: number
  totalCost: number
  totalQuantity: number
  unit: IngredientUnit
  /** The unit is frozen once a lot exists; mixing kg and g lots would corrupt the average. */
  unitLocked: boolean
}

export type IngredientPurchase = {
  id: string
  ingredientId: string
  ingredientName: string
  note: string | null
  purchasedOn: string
  quantity: number
  totalCost: number
  unit: IngredientUnit
  unitCost: number
}

export type IngredientPurchaseReport = {
  items: IngredientPurchase[]
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
  }
  range: {
    endAt: string
    startAt: string
  }
  summary: {
    lotCount: number
    totalCost: number
  }
  timezone: 'Asia/Bangkok'
}

export type RecipeItem = {
  batchQuantity: number
  batchYield: number
  ingredientArchivedAt: string | null
  ingredientId: string
  ingredientName: string
  ingredientUnit: IngredientUnit
  /** This line's share of one skewer's cost. Null when the ingredient has no lot yet. */
  unitCost: number | null
}

export type ProductCosting = {
  categoryName: string | null
  id: string
  /** profitPerUnit / price. Null when the cost is unknown or the price is zero. */
  marginRatio: number | null
  /** Recipe lines whose ingredient has no purchase lot, so the product cost is unknown. */
  missingIngredientCount: number
  name: string
  price: number
  profitPerUnit: number | null
  recipe: RecipeItem[]
  /** Null when the product has no recipe, or any recipe ingredient has no lot. */
  unitCost: number | null
}

export type CostingOverview = {
  ingredients: Ingredient[]
  products: ProductCosting[]
}

export type ProfitSummary = {
  /** revenue - purchaseCost. Cash in minus cash out, not profit. */
  cashProfit: number
  cogs: number
  costedItemCount: number
  costedRevenue: number
  /** revenue - cogs. Overstated by uncostedRevenue until every menu has a recipe. */
  grossProfit: number
  itemCount: number
  orderCount: number
  purchaseCost: number
  /** Order totals, the same source as the existing sales summary card. */
  revenue: number
  uncostedItemCount: number
  uncostedRevenue: number
}

export type ProfitReport = ProfitSummary & {
  date: string | null
  month: string | null
  period: SalesPeriod | null
  range: {
    endAt: string
    startAt: string
  }
  timezone: 'Asia/Bangkok'
}

export type MonthlyProfit = ProfitSummary & {
  month: string
}

export type MonthlyProfitReport = {
  months: MonthlyProfit[]
  range: {
    endAt: string
    startAt: string
  }
  timezone: 'Asia/Bangkok'
}

export type IngredientInput = {
  name: string
  unit: IngredientUnit
}

export type IngredientPurchaseInput = {
  ingredientId: string
  note: string | null
  purchasedOn: string
  quantity: number
  totalCost: number
}

export type RecipeItemInput = {
  batchQuantity: number
  batchYield: number
  ingredientId: string
}

export interface CostingRepository {
  archiveIngredient(id: string): Promise<void>
  createIngredient(input: IngredientInput): Promise<Ingredient>
  createPurchase(input: IngredientPurchaseInput): Promise<IngredientPurchase>
  deleteIngredient(id: string): Promise<void>
  deletePurchase(id: string): Promise<void>
  getIngredient(id: string): Promise<Ingredient | null>
  listMonthlyProfit(startAt: string, endAt: string): Promise<MonthlyProfit[]>
  listOverview(): Promise<CostingOverview>
  listPurchases(
    startAt: string,
    endAt: string,
    ingredientId: string | null,
    page: number,
    pageSize: number,
  ): Promise<IngredientPurchaseReport>
  profitSummary(startAt: string, endAt: string): Promise<ProfitSummary>
  restoreIngredient(id: string): Promise<void>
  setProductRecipe(productId: string, items: RecipeItemInput[]): Promise<ProductCosting>
  updateIngredient(id: string, input: IngredientInput): Promise<Ingredient>
  updatePurchase(id: string, input: IngredientPurchaseInput): Promise<IngredientPurchase>
}

export class IngredientUnitLockedError extends Error {
  constructor() {
    super('INGREDIENT_UNIT_LOCKED')
    this.name = 'IngredientUnitLockedError'
  }
}

export class IngredientInUseError extends Error {
  constructor() {
    super('INGREDIENT_IN_USE')
    this.name = 'IngredientInUseError'
  }
}

export class InvalidRecipeError extends Error {
  constructor() {
    super('INVALID_RECIPE')
    this.name = 'InvalidRecipeError'
  }
}

/**
 * A PostgREST update or delete that matches no row reports success, so the
 * repository raises this instead of letting a no-op read back as a saved edit.
 */
export class PurchaseNotFoundError extends Error {
  constructor() {
    super('PURCHASE_NOT_FOUND')
    this.name = 'PurchaseNotFoundError'
  }
}
