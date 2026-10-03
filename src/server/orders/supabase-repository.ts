import { getSupabaseServerClient } from '@/server/supabase'
import {
  InvalidOrderError,
  OrderCatalogChangedError,
  type CreatePaidOrderInput,
  type OrderRepository,
  type PaidOrder,
  type SalesReport,
  type SalesOrder,
  type SalesOrderItem,
  type TopSellingProduct,
} from '@/server/orders/types'

type PaidOrderRow = {
  discount: number | string
  id: string
  itemCount?: number | string
  item_count?: number | string
  orderNumber?: number | string
  order_number?: number | string
  paymentMethod?: null
  payment_method?: null
  soldAt?: string
  sold_at?: string
  status: 'paid'
  subtotal: number | string
  total: number | string
}

type SalesOrderItemRow = {
  id: string
  product_id: string | null
  product_name: string
  quantity: number
  unit_price: number | string
}

type SalesOrderRow = Omit<PaidOrderRow, 'itemCount' | 'item_count'> & {
  order_items: SalesOrderItemRow[]
}

type DailySummaryRow = {
  item_count: number | string
  order_count: number | string
  total_sales: number | string
}

type SalesSummaryOrderItemRow = {
  quantity: number
}

type SalesSummaryAggregateRow = {
  order_items: SalesSummaryOrderItemRow[] | null
  total: number | string
}

type TopSellingProductRow = {
  category_name: string | null
  is_archived: boolean
  product_id: string | null
  product_name: string
  quantity: number | string
  rank: number | string
  total_sales: number | string
}

function mapPaidOrder(row: PaidOrderRow): PaidOrder {
  return {
    discount: Number(row.discount),
    id: row.id,
    itemCount: Number(row.itemCount ?? row.item_count ?? 0),
    orderNumber: String(row.orderNumber ?? row.order_number),
    paymentMethod: null,
    soldAt: String(row.soldAt ?? row.sold_at),
    status: 'paid',
    subtotal: Number(row.subtotal),
    total: Number(row.total),
  }
}

function mapOrderItem(row: SalesOrderItemRow): SalesOrderItem {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
  }
}

function mapSalesOrder(row: SalesOrderRow): SalesOrder {
  const items = [...row.order_items]
    .sort((a, b) => a.product_name.localeCompare(b.product_name, 'th'))
    .map(mapOrderItem)
  return {
    ...mapPaidOrder({ ...row, itemCount: items.reduce((sum, item) => sum + item.quantity, 0) }),
    items,
  }
}

function isMissingSalesSummaryFunction(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'PGRST202'
}

function buildSummaryFromOrders(
  rows: SalesSummaryAggregateRow[],
  orderCount: number,
): DailySummaryRow {
  return rows.reduce<DailySummaryRow>((summary, row) => ({
    item_count: Number(summary.item_count) + (row.order_items ?? []).reduce(
      (total, item) => total + item.quantity,
      0,
    ),
    order_count: orderCount,
    total_sales: Number(summary.total_sales) + Number(row.total),
  }), {
    item_count: 0,
    order_count: orderCount,
    total_sales: 0,
  })
}

export class SupabaseOrderRepository implements OrderRepository {
  async createPaidOrder(input: CreatePaidOrderInput): Promise<PaidOrder> {
    const { data, error } = await getSupabaseServerClient().rpc('create_paid_order', {
      request_id: input.requestId,
      requested_items: input.items,
    })

    if (error) {
      if (error.message.includes('ORDER_CATALOG_CHANGED')) throw new OrderCatalogChangedError()
      if (error.message.includes('INVALID_ORDER')) throw new InvalidOrderError()
      throw error
    }

    return mapPaidOrder(data as PaidOrderRow)
  }

  async listSales(startAt: string, endAt: string, page: number, pageSize: number): Promise<SalesReport> {
    const supabase = getSupabaseServerClient()
    const offset = (page - 1) * pageSize
    const [summaryResult, ordersResult] = await Promise.all([
      supabase.rpc('get_sales_summary', {
        report_end: endAt,
        report_start: startAt,
      }),
      supabase
        .from('orders')
        .select(`
          id, order_number, status, subtotal, discount, total,
          payment_method, sold_at,
          order_items (id, product_id, product_name, unit_price, quantity)
        `, { count: 'exact' })
        .eq('status', 'paid')
        .gte('sold_at', startAt)
        .lt('sold_at', endAt)
        .order('sold_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + pageSize - 1),
    ])

    if (ordersResult.error) throw ordersResult.error

    let summary = ((summaryResult.data ?? [])[0] ?? {
      item_count: 0,
      order_count: 0,
      total_sales: 0,
    }) as DailySummaryRow

    if (summaryResult.error) {
      if (!isMissingSalesSummaryFunction(summaryResult.error)) throw summaryResult.error

      const fallbackSummaryResult = await supabase
        .from('orders')
        .select('total, order_items (quantity)', { count: 'exact' })
        .eq('status', 'paid')
        .gte('sold_at', startAt)
        .lt('sold_at', endAt)

      if (fallbackSummaryResult.error) throw fallbackSummaryResult.error

      summary = buildSummaryFromOrders(
        (fallbackSummaryResult.data ?? []) as SalesSummaryAggregateRow[],
        fallbackSummaryResult.count ?? 0,
      )
    }

    const totalItems = ordersResult.count ?? 0

    return {
      date: null,
      period: null,
      range: { endAt, startAt },
      orders: ((ordersResult.data ?? []) as SalesOrderRow[]).map(mapSalesOrder),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      },
      summary: {
        itemCount: Number(summary.item_count),
        orderCount: Number(summary.order_count),
        totalSales: Number(summary.total_sales),
      },
      timezone: 'Asia/Bangkok',
    }
  }

  async listTopSellingProducts(startAt: string, endAt: string, limit: number) {
    const { data, error } = await getSupabaseServerClient().rpc('get_top_selling_products', {
      report_end: endAt,
      report_start: startAt,
      result_limit: limit,
    })
    if (error) throw error

    return ((data ?? []) as TopSellingProductRow[]).map((row): TopSellingProduct => ({
      categoryName: row.category_name,
      isArchived: row.is_archived,
      productId: row.product_id,
      productName: row.product_name,
      quantity: Number(row.quantity),
      rank: Number(row.rank),
      totalSales: Number(row.total_sales),
    }))
  }
}
