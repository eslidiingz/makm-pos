export type OrderItemInput = {
  expectedUnitPrice: number
  productId: string
  quantity: number
}

export type CreatePaidOrderInput = {
  items: OrderItemInput[]
  requestId: string
}

export type SalesPeriod = 'today' | 'this_week' | 'this_month'

export type TopSellingProduct = {
  categoryName: string | null
  isArchived: boolean
  productId: string | null
  productName: string
  quantity: number
  rank: number
  totalSales: number
}

export type TopSellingProductsReport = {
  items: TopSellingProduct[]
  period: SalesPeriod
  range: {
    endAt: string
    startAt: string
  }
  timezone: 'Asia/Bangkok'
}

export type PaidOrder = {
  discount: number
  id: string
  itemCount: number
  orderNumber: string
  paymentMethod: null
  soldAt: string
  status: 'paid'
  subtotal: number
  total: number
}

export type SalesOrderItem = {
  id: string
  productId: string | null
  productName: string
  quantity: number
  unitPrice: number
}

export type SalesOrder = PaidOrder & {
  items: SalesOrderItem[]
}

export type SalesReport = {
  date: string | null
  period: SalesPeriod | null
  range: {
    endAt: string
    startAt: string
  }
  orders: SalesOrder[]
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
  }
  summary: {
    itemCount: number
    orderCount: number
    totalSales: number
  }
  timezone: 'Asia/Bangkok'
}

export interface OrderRepository {
  createPaidOrder(input: CreatePaidOrderInput): Promise<PaidOrder>
  listSales(startAt: string, endAt: string, page: number, pageSize: number): Promise<SalesReport>
  listTopSellingProducts(
    startAt: string,
    endAt: string,
    limit: number,
  ): Promise<TopSellingProduct[]>
}

export class OrderCatalogChangedError extends Error {
  constructor() {
    super('ORDER_CATALOG_CHANGED')
    this.name = 'OrderCatalogChangedError'
  }
}

export class InvalidOrderError extends Error {
  constructor() {
    super('INVALID_ORDER')
    this.name = 'InvalidOrderError'
  }
}
