import { Elysia, status, t, ValidationError } from 'elysia'

import {
  clearAuthCookies,
  readAuthCookies,
  sessionRemainingSeconds,
  setAuthCookies,
  verifySessionStart,
} from '@/server/auth/session'
import { SupabaseAuthGateway } from '@/server/auth/supabase-gateway'
import {
  isPlatformOwner,
  toOwnerDto,
  type AuthGateway,
  type AuthSession,
  type AuthUser,
} from '@/server/auth/types'
import { normalizeThaiPhone, validatePassword } from '@/server/auth/validation'
import { createObjectStorageGateway } from '@/server/catalog/r2-storage'
import { SupabaseCatalogRepository } from '@/server/catalog/supabase-repository'
import type {
  CatalogRepository,
  ObjectStorageGateway,
} from '@/server/catalog/types'
import {
  isPendingImageKey,
  isValidCatalogName,
  isValidPrice,
  isValidUuid,
  MAX_WEBP_IMAGE_BYTES,
  normalizeCatalogName,
  WEBP_CONTENT_TYPE,
} from '@/server/catalog/validation'
import { SupabaseCostingRepository } from '@/server/costing/supabase-repository'
import {
  IngredientUnitLockedError,
  InvalidRecipeError,
  PurchaseNotFoundError,
  type CostingRepository,
} from '@/server/costing/types'
import {
  isIngredientUnit,
  isValidIngredientName,
  isValidPurchaseCost,
  isValidPurchaseNote,
  isValidPurchasePage,
  isValidPurchaseQuantity,
  isValidRecipeItems,
  normalizeIngredientName,
  normalizePurchaseNote,
} from '@/server/costing/validation'
import { SupabaseOrderRepository } from '@/server/orders/supabase-repository'
import {
  InvalidOrderError,
  OrderCatalogChangedError,
  type OrderRepository,
} from '@/server/orders/types'
import {
  bangkokDayRange,
  bangkokMonthKey,
  bangkokMonthRange,
  bangkokSalesPeriodRange,
  bangkokTrailingMonthsRange,
  isSalesPeriod,
  isValidOrderItems,
  isValidReportDate,
  isValidReportMonth,
} from '@/server/orders/validation'

const INVALID_LOGIN = {
  code: 'INVALID_CREDENTIALS',
  message: 'เบอร์มือถือหรือรหัสผ่านไม่ถูกต้อง',
} as const

const UNAUTHORIZED = {
  code: 'UNAUTHORIZED',
  message: 'กรุณาเข้าสู่ระบบอีกครั้ง',
} as const

const PASSWORD_CHANGE_REQUIRED = {
  code: 'PASSWORD_CHANGE_REQUIRED',
  message: 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งานระบบ',
} as const

const INVALID_CATALOG_INPUT = {
  code: 'INVALID_CATALOG_INPUT',
  message: 'ข้อมูลประเภทหรือเมนูไม่ถูกต้อง',
} as const

const INVALID_ORDER = {
  code: 'INVALID_ORDER',
  message: 'ข้อมูลออเดอร์ไม่ถูกต้อง',
} as const

const ORDER_CATALOG_CHANGED = {
  code: 'ORDER_CATALOG_CHANGED',
  message: 'ข้อมูลเมนูหรือราคามีการเปลี่ยนแปลง กรุณาตรวจสอบออเดอร์อีกครั้ง',
} as const

const INVALID_COSTING_INPUT = {
  code: 'INVALID_COSTING_INPUT',
  message: 'ข้อมูลวัตถุดิบหรือการซื้อไม่ถูกต้อง',
} as const

const INGREDIENT_NOT_FOUND = {
  code: 'INGREDIENT_NOT_FOUND',
  message: 'ไม่พบวัตถุดิบนี้',
} as const

const INGREDIENT_NAME_EXISTS = {
  code: 'INGREDIENT_NAME_EXISTS',
  message: 'มีวัตถุดิบชื่อนี้แล้ว',
} as const

const INGREDIENT_UNIT_LOCKED = {
  code: 'INGREDIENT_UNIT_LOCKED',
  message: 'เปลี่ยนหน่วยไม่ได้ เพราะมีการบันทึกการซื้อไว้แล้ว การเปลี่ยนหน่วยจะทำให้ต้นทุนที่ผ่านมาผิดทั้งหมด',
} as const

const INGREDIENT_IN_USE = {
  code: 'INGREDIENT_IN_USE',
  message: 'วัตถุดิบนี้ยังถูกใช้ในสูตรของเมนูที่ขายอยู่ กรุณาลบออกจากสูตรก่อน',
} as const

const PURCHASE_NOT_FOUND = {
  code: 'PURCHASE_NOT_FOUND',
  message: 'ไม่พบรายการซื้อนี้',
} as const

const INVALID_RECIPE = {
  code: 'INVALID_RECIPE',
  message: 'สูตรไม่ถูกต้อง กรุณาตรวจสอบวัตถุดิบและปริมาณอีกครั้ง',
} as const

const INVALID_REPORT_FILTER = {
  code: 'INVALID_REPORT_FILTER',
  message: 'กรุณาเลือกช่วงเวลา วันที่ หรือเดือนอย่างใดอย่างหนึ่ง',
} as const

const INVALID_REPORT_MONTH = {
  code: 'INVALID_REPORT_MONTH',
  message: 'เดือนที่เลือกไม่ถูกต้อง',
} as const

function isDatabaseConflict(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === '23505'
}

function isDatabaseForeignKeyViolation(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === '23503'
}

function isSupabaseTimestampError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'PGRST303'
}

type AppDependencies = {
  auth: AuthGateway
  catalog: CatalogRepository
  costing: CostingRepository
  now: () => number
  orders: OrderRepository
  storage: ObjectStorageGateway
}

type OwnerSession = {
  session: AuthSession
  startedAt: number
  user: AuthUser
}

function isTrustedMutationOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return false

  try {
    const requestOrigin = new URL(request.url).origin
    const configuredOrigin = process.env.APP_ORIGIN
      ? new URL(process.env.APP_ORIGIN).origin
      : requestOrigin
    const allowedDevelopmentOrigins = process.env.NODE_ENV === 'production'
      ? []
      : (process.env.DEV_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => new URL(value).origin)
    const trustedOrigins = process.env.NODE_ENV === 'production'
      ? [configuredOrigin]
      : [requestOrigin, configuredOrigin, ...allowedDevelopmentOrigins]
    return trustedOrigins.includes(new URL(origin).origin)
  } catch {
    return false
  }
}

function requestFingerprint(request: Request) {
  return request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'local'
}

function createLoginRateLimiter(now: () => number) {
  const attempts = new Map<string, { count: number; resetAt: number }>()
  const windowMs = 15 * 60 * 1000
  const maxAttempts = 10

  return (request: Request) => {
    const key = requestFingerprint(request)
    const currentTime = now()
    const existing = attempts.get(key)
    if (!existing || existing.resetAt <= currentTime) {
      attempts.set(key, { count: 1, resetAt: currentTime + windowMs })
      return true
    }

    existing.count += 1
    if (attempts.size > 10_000) {
      for (const [candidate, value] of attempts) {
        if (value.resetAt <= currentTime) attempts.delete(candidate)
      }
    }
    return existing.count <= maxAttempts
  }
}

export function createApp(overrides: Partial<AppDependencies> = {}) {
  const storage = overrides.storage ?? createObjectStorageGateway()
  const dependencies: AppDependencies = {
    auth: overrides.auth ?? new SupabaseAuthGateway(),
    catalog: overrides.catalog ?? new SupabaseCatalogRepository(storage),
    costing: overrides.costing ?? new SupabaseCostingRepository(),
    now: overrides.now ?? Date.now,
    orders: overrides.orders ?? new SupabaseOrderRepository(),
    storage,
  }
  const allowLoginAttempt = createLoginRateLimiter(dependencies.now)
  const refreshes = new Map<string, {
    expiresAt: number
    result: ReturnType<AuthGateway['refresh']>
  }>()

  function refreshSessionOnce(refreshToken: string) {
    const currentTime = dependencies.now()
    const existing = refreshes.get(refreshToken)
    if (existing && existing.expiresAt > currentTime) return existing.result

    const result = dependencies.auth.refresh(refreshToken)
    refreshes.set(refreshToken, { expiresAt: currentTime + 5_000, result })
    if (refreshes.size > 100) {
      for (const [token, entry] of refreshes) {
        if (entry.expiresAt <= currentTime) refreshes.delete(token)
      }
    }
    return result
  }

  function denyOwnerSession(reason: string, cookies: Parameters<typeof readAuthCookies>[0]) {
    // Keep this intentionally free of phone numbers and tokens. It lets us
    // distinguish a genuinely expired session from a cookie/update race in
    // development and server logs without exposing credentials.
    console.warn('Owner session rejected', { reason })
    clearAuthCookies(cookies)
    return null
  }

  async function resolveOwnerSession(
    cookies: Parameters<typeof readAuthCookies>[0],
  ): Promise<OwnerSession | null> {
    const stored = readAuthCookies(cookies)
    const startedAt = verifySessionStart(stored.signedStartedAt)
    if (
      !stored.accessToken
      || !stored.refreshToken
      || !startedAt
      || sessionRemainingSeconds(startedAt, dependencies.now()) <= 0
    ) {
      return denyOwnerSession(
        !stored.accessToken || !stored.refreshToken
          ? 'missing_auth_cookie'
          : !startedAt
            ? 'invalid_session_start'
            : 'absolute_session_expired',
        cookies,
      )
    }

    const user = await dependencies.auth.getUser(stored.accessToken)
    if (user) {
      if (!isPlatformOwner(user)) {
        await dependencies.auth.revoke(stored.accessToken, stored.refreshToken)
        return denyOwnerSession('user_is_not_platform_owner', cookies)
      }

      return {
        session: {
          accessToken: stored.accessToken,
          expiresIn: sessionRemainingSeconds(startedAt, dependencies.now()),
          refreshToken: stored.refreshToken,
        },
        startedAt,
        user,
      }
    }

    // React Strict Mode and multiple open tabs can verify the same expired
    // session concurrently. Share the rotated refresh result briefly so the
    // requests cannot invalidate one another's newly-issued cookie pair.
    const refreshed = await refreshSessionOnce(stored.refreshToken)
    if (!refreshed || !isPlatformOwner(refreshed.user)) {
      if (refreshed) {
        await dependencies.auth.revoke(
          refreshed.session.accessToken,
          refreshed.session.refreshToken,
        )
      }
      return denyOwnerSession(
        refreshed ? 'refreshed_user_is_not_platform_owner' : 'access_and_refresh_rejected',
        cookies,
      )
    }

    if (!setAuthCookies(
      cookies,
      refreshed.session,
      startedAt,
      dependencies.now(),
    )) return null

    return { ...refreshed, startedAt }
  }

  return new Elysia({ prefix: '/api' })
    .error('global', ({ error, set }) => {
      if (error instanceof ValidationError) {
        set.status = 400
        return { code: 'INVALID_REQUEST', message: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' }
      }

      if (isSupabaseTimestampError(error)) {
        set.status = 503
        return {
          code: 'CATALOG_TEMPORARILY_UNAVAILABLE',
          message: 'บริการข้อมูลกำลังเชื่อมต่อใหม่ กรุณาลองอีกครั้งในครู่เดียว',
        }
      }

      console.error('API request failed', error)
      set.status = 500
      return { code: 'INTERNAL_ERROR', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' }
    })
    .get('/health', () => ({ ok: true, service: 'makm-pos-api' as const }))
    .post('/auth/login', {
      body: t.Object({
        password: t.String({ maxLength: 128, minLength: 1 }),
        phone: t.String({ maxLength: 32, minLength: 1 }),
      }),
    }, async ({ body, cookie, request }) => {
      if (!isTrustedMutationOrigin(request)) {
        return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
      }
      if (!allowLoginAttempt(request)) {
        return status(429, { code: 'TOO_MANY_ATTEMPTS', message: 'ลองใหม่อีกครั้งภายหลัง' })
      }

      const phone = normalizeThaiPhone(body.phone)
      if (!phone) return status(401, INVALID_LOGIN)

      const result = await dependencies.auth.signIn(phone, body.password)
      if (!result || !isPlatformOwner(result.user)) {
        if (result) {
          await dependencies.auth.revoke(
            result.session.accessToken,
            result.session.refreshToken,
          )
          clearAuthCookies(cookie)
        }
        return status(401, INVALID_LOGIN)
      }

      setAuthCookies(cookie, result.session, dependencies.now(), dependencies.now())
      return { user: toOwnerDto(result.user) }
    })
    .derive(async ({ cookie }) => ({
      ownerSession: await resolveOwnerSession(cookie),
    }))
    .guard({
      beforeHandle: ({ ownerSession, request }) => {
        if (!ownerSession) return status(401, UNAUTHORIZED)
        const pathname = new URL(request.url).pathname
        const passwordChangeRoutes = new Set([
          '/api/auth/me',
          '/api/auth/change-password',
          '/api/auth/logout',
        ])
        if (
          ownerSession.user.appMetadata.must_change_password === true
          && !passwordChangeRoutes.has(pathname)
        ) {
          return status(403, PASSWORD_CHANGE_REQUIRED)
        }
      },
    }, (authorized) => authorized
      .get('/auth/me', ({ ownerSession }) => ({
        user: toOwnerDto(ownerSession!.user),
      }))
      .post('/auth/change-password', {
        body: t.Object({
          currentPassword: t.String({ maxLength: 128, minLength: 1 }),
          newPassword: t.String({ maxLength: 128, minLength: 8 }),
        }),
      }, async ({ body, cookie, ownerSession, request }) => {
        if (!isTrustedMutationOrigin(request)) {
          return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
        }
        if (
          !validatePassword(body.newPassword)
          || body.currentPassword === body.newPassword
        ) {
          return status(400, {
            code: 'INVALID_NEW_PASSWORD',
            message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวและไม่ซ้ำรหัสเดิม',
          })
        }

        const changed = await dependencies.auth.changePassword(
          ownerSession!.user.phone ?? '',
          body.currentPassword,
          body.newPassword,
        )
        if (!changed || !isPlatformOwner(changed.user)) {
          return status(400, {
            code: 'PASSWORD_CHANGE_FAILED',
            message: 'ไม่สามารถเปลี่ยนรหัสผ่านได้ กรุณาตรวจสอบรหัสเดิม',
          })
        }

        setAuthCookies(
          cookie,
          changed.session,
          ownerSession!.startedAt,
          dependencies.now(),
        )
        return { user: toOwnerDto(changed.user) }
      })
      .post('/auth/logout', async ({ cookie, ownerSession, request }) => {
        if (!isTrustedMutationOrigin(request)) {
          return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
        }

        try {
          await dependencies.auth.revoke(
            ownerSession!.session.accessToken,
            ownerSession!.session.refreshToken,
          )
        } finally {
          clearAuthCookies(cookie)
        }
        return { ok: true }
      })
      .get('/catalog', () => dependencies.catalog.listPosCatalog())
        .get('/products', async () => (await dependencies.catalog.listPosCatalog()).products)
        .get('/admin/catalog', () => dependencies.catalog.listAdminCatalog())
        .post('/admin/categories', {
          body: t.Object({
            isActive: t.Boolean(),
            name: t.String({ maxLength: 80, minLength: 1 }),
          }),
        }, async ({ body, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidCatalogName(body.name)) return status(400, INVALID_CATALOG_INPUT)

          try {
            return await dependencies.catalog.createCategory({
              isActive: body.isActive,
              name: normalizeCatalogName(body.name),
            })
          } catch (error) {
            if (isDatabaseConflict(error)) {
              return status(409, { code: 'CATEGORY_NAME_EXISTS', message: 'มีประเภทชื่อนี้แล้ว' })
            }
            throw error
          }
        })
        .patch('/admin/categories/:id', {
          body: t.Object({
            isActive: t.Boolean(),
            name: t.String({ maxLength: 80, minLength: 1 }),
          }),
          params: t.Object({ id: t.String() }),
        }, async ({ body, params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidUuid(params.id) || !isValidCatalogName(body.name)) {
            return status(400, INVALID_CATALOG_INPUT)
          }

          try {
            return await dependencies.catalog.updateCategory(params.id, {
              isActive: body.isActive,
              name: normalizeCatalogName(body.name),
            })
          } catch (error) {
            if (isDatabaseConflict(error)) {
              return status(409, { code: 'CATEGORY_NAME_EXISTS', message: 'มีประเภทชื่อนี้แล้ว' })
            }
            throw error
          }
        })
        .post('/admin/categories/:id/archive', {
          params: t.Object({ id: t.String() }),
        }, async ({ params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidUuid(params.id)) return status(400, INVALID_CATALOG_INPUT)
          await dependencies.catalog.archiveCategory(params.id)
          return { ok: true }
        })
        .post('/admin/categories/:id/restore', {
          params: t.Object({ id: t.String() }),
        }, async ({ params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidUuid(params.id)) return status(400, INVALID_CATALOG_INPUT)
          try {
            await dependencies.catalog.restoreCategory(params.id)
            return { ok: true }
          } catch (error) {
            if (isDatabaseConflict(error)) {
              return status(409, { code: 'CATEGORY_NAME_EXISTS', message: 'มีประเภทชื่อนี้แล้ว' })
            }
            throw error
          }
        })
        .delete('/admin/categories/:id', {
          params: t.Object({ id: t.String() }),
        }, async ({ params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidUuid(params.id)) return status(400, INVALID_CATALOG_INPUT)

          const catalog = await dependencies.catalog.listAdminCatalog()
          const category = catalog.categories.find((candidate) => candidate.id === params.id)
          if (!category || !category.archivedAt) {
            return status(404, { code: 'CATEGORY_NOT_FOUND', message: 'ไม่พบประเภทที่เก็บไว้นี้' })
          }

          try {
            await dependencies.catalog.deleteCategory(params.id)
            return { ok: true }
          } catch (error) {
            if (isDatabaseForeignKeyViolation(error)) {
              return status(409, { code: 'CATEGORY_HAS_PRODUCTS', message: 'ยังมีเมนูอยู่ในประเภทนี้ กรุณาลบเมนูให้หมดก่อน' })
            }
            throw error
          }
        })
        .post('/admin/categories/reorder', {
          body: t.Object({ ids: t.Array(t.String(), { maxItems: 500, minItems: 1 }) }),
        }, async ({ body, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!body.ids.every(isValidUuid) || new Set(body.ids).size !== body.ids.length) {
            return status(400, INVALID_CATALOG_INPUT)
          }
          await dependencies.catalog.reorderCategories(body.ids)
          return { ok: true }
        })
        .post('/admin/product-images/presign', {
          body: t.Object({
            contentType: t.Literal(WEBP_CONTENT_TYPE),
            size: t.Integer({ maximum: MAX_WEBP_IMAGE_BYTES, minimum: 1 }),
          }),
        }, async ({ request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!dependencies.storage.configured) {
            return status(503, {
              code: 'STORAGE_NOT_CONFIGURED',
              message: 'ยังไม่ได้ตั้งค่า Cloudflare R2',
            })
          }
          return dependencies.storage.presignWebpUpload()
        })
        .post('/admin/products', {
          body: t.Object({
            categoryId: t.String(),
            isAvailable: t.Boolean(),
            name: t.String({ maxLength: 80, minLength: 1 }),
            pendingImageKey: t.Optional(t.Union([t.String(), t.Null()])),
            price: t.Number({ maximum: 999_999.99, minimum: 0 }),
          }),
        }, async ({ body, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (
            !isValidUuid(body.categoryId)
            || !isValidCatalogName(body.name)
            || !isValidPrice(body.price)
            || (typeof body.pendingImageKey === 'string' && !isPendingImageKey(body.pendingImageKey))
          ) return status(400, INVALID_CATALOG_INPUT)

          const catalog = await dependencies.catalog.listAdminCatalog()
          const category = catalog.categories.find(
            (candidate) => candidate.id === body.categoryId && !candidate.archivedAt,
          )
          if (!category) {
            return status(400, { code: 'CATEGORY_NOT_FOUND', message: 'ไม่พบประเภทที่เลือก' })
          }

          const id = crypto.randomUUID()
          let imageKey: string | null = null
          if (body.pendingImageKey) {
            if (!dependencies.storage.configured) {
              return status(503, { code: 'STORAGE_NOT_CONFIGURED', message: 'ยังไม่ได้ตั้งค่า Cloudflare R2' })
            }
            imageKey = await dependencies.storage.finalize(body.pendingImageKey, id)
          }

          try {
            return await dependencies.catalog.createProduct({
              categoryId: body.categoryId,
              id,
              imageKey,
              isAvailable: body.isAvailable,
              name: normalizeCatalogName(body.name),
              price: body.price,
            })
          } catch (error) {
            if (imageKey) await dependencies.storage.delete(imageKey).catch(() => undefined)
            if (isDatabaseConflict(error)) {
              return status(409, { code: 'PRODUCT_NAME_EXISTS', message: 'มีเมนูชื่อนี้ในประเภทแล้ว' })
            }
            throw error
          }
        })
        .patch('/admin/products/:id', {
          body: t.Object({
            categoryId: t.String(),
            isAvailable: t.Boolean(),
            name: t.String({ maxLength: 80, minLength: 1 }),
            pendingImageKey: t.Optional(t.Union([t.String(), t.Null()])),
            price: t.Number({ maximum: 999_999.99, minimum: 0 }),
          }),
          params: t.Object({ id: t.String() }),
        }, async ({ body, params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (
            !isValidUuid(params.id)
            || !isValidUuid(body.categoryId)
            || !isValidCatalogName(body.name)
            || !isValidPrice(body.price)
            || (typeof body.pendingImageKey === 'string' && !isPendingImageKey(body.pendingImageKey))
          ) return status(400, INVALID_CATALOG_INPUT)

          const [existing, catalog] = await Promise.all([
            dependencies.catalog.getProduct(params.id),
            dependencies.catalog.listAdminCatalog(),
          ])
          if (!existing || existing.archivedAt) {
            return status(404, { code: 'PRODUCT_NOT_FOUND', message: 'ไม่พบเมนูนี้' })
          }
          if (!catalog.categories.some(
            (category) => category.id === body.categoryId && !category.archivedAt,
          )) {
            return status(400, { code: 'CATEGORY_NOT_FOUND', message: 'ไม่พบประเภทที่เลือก' })
          }

          let imageKey = existing.imageKey
          let newImageKey: string | null = null
          if (body.pendingImageKey === null) imageKey = null
          if (typeof body.pendingImageKey === 'string') {
            if (!dependencies.storage.configured) {
              return status(503, { code: 'STORAGE_NOT_CONFIGURED', message: 'ยังไม่ได้ตั้งค่า Cloudflare R2' })
            }
            newImageKey = await dependencies.storage.finalize(body.pendingImageKey, params.id)
            imageKey = newImageKey
          }

          try {
            const product = await dependencies.catalog.updateProduct(params.id, {
              categoryId: body.categoryId,
              imageKey,
              isAvailable: body.isAvailable,
              name: normalizeCatalogName(body.name),
              price: body.price,
            })
            if (existing.imageKey && existing.imageKey !== imageKey) {
              await dependencies.storage.delete(existing.imageKey).catch(() => undefined)
            }
            return product
          } catch (error) {
            if (newImageKey) await dependencies.storage.delete(newImageKey).catch(() => undefined)
            if (isDatabaseConflict(error)) {
              return status(409, { code: 'PRODUCT_NAME_EXISTS', message: 'มีเมนูชื่อนี้ในประเภทแล้ว' })
            }
            throw error
          }
        })
        .post('/admin/products/:id/archive', {
          params: t.Object({ id: t.String() }),
        }, async ({ params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidUuid(params.id)) return status(400, INVALID_CATALOG_INPUT)
          await dependencies.catalog.archiveProduct(params.id)
          return { ok: true }
        })
        .post('/admin/products/:id/restore', {
          params: t.Object({ id: t.String() }),
        }, async ({ params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidUuid(params.id)) return status(400, INVALID_CATALOG_INPUT)
          try {
            await dependencies.catalog.restoreProduct(params.id)
            return { ok: true }
          } catch (error) {
            if (isDatabaseConflict(error)) {
              return status(409, { code: 'PRODUCT_NAME_EXISTS', message: 'มีเมนูชื่อนี้ในประเภทแล้ว' })
            }
            throw error
          }
        })
        .delete('/admin/products/:id', {
          params: t.Object({ id: t.String() }),
        }, async ({ params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidUuid(params.id)) return status(400, INVALID_CATALOG_INPUT)

          const existing = await dependencies.catalog.getProduct(params.id)
          if (!existing || !existing.archivedAt) {
            return status(404, { code: 'PRODUCT_NOT_FOUND', message: 'ไม่พบเมนูที่เก็บไว้นี้' })
          }

          await dependencies.catalog.deleteProduct(params.id)
          if (existing.imageKey) await dependencies.storage.delete(existing.imageKey).catch(() => undefined)
          return { ok: true }
        })
        .post('/admin/products/reorder', {
          body: t.Object({
            categoryId: t.String(),
            ids: t.Array(t.String(), { maxItems: 1000, minItems: 1 }),
          }),
        }, async ({ body, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (
            !isValidUuid(body.categoryId)
            || !body.ids.every(isValidUuid)
            || new Set(body.ids).size !== body.ids.length
          ) return status(400, INVALID_CATALOG_INPUT)
          await dependencies.catalog.reorderProducts(body.categoryId, body.ids)
          return { ok: true }
        })
        .post('/orders', {
          body: t.Object({
            requestId: t.String({ maxLength: 36, minLength: 36 }),
            items: t.Array(t.Object({
              expectedUnitPrice: t.Number({ minimum: 0 }),
              productId: t.String({ maxLength: 36, minLength: 36 }),
              quantity: t.Integer({ maximum: 100, minimum: 1 }),
            }), { maxItems: 100, minItems: 1 }),
          }),
        }, async ({ body, request, set }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidUuid(body.requestId) || !isValidOrderItems(body.items)) {
            return status(400, INVALID_ORDER)
          }

          try {
            const order = await dependencies.orders.createPaidOrder(body)
            set.headers.location = `/api/orders/${order.id}`
            return status(201, { order })
          } catch (error) {
            if (error instanceof OrderCatalogChangedError) {
              return status(409, ORDER_CATALOG_CHANGED)
            }
            if (error instanceof InvalidOrderError) {
              return status(400, INVALID_ORDER)
            }
            throw error
          }
        })
        .get('/admin/sales/daily', {
          query: t.Object({
            date: t.Optional(t.String({ maxLength: 10, minLength: 10 })),
            page: t.Optional(t.Numeric({ maximum: 100_000, minimum: 1 })),
            pageSize: t.Optional(t.Numeric({ maximum: 100, minimum: 1 })),
            period: t.Optional(t.String({ maxLength: 10, minLength: 2 })),
          }),
        }, async ({ query }) => {
          if (Boolean(query.date) === Boolean(query.period)) {
            return status(400, { code: 'INVALID_REPORT_FILTER', message: 'กรุณาเลือกช่วงเวลาหรือวันที่' })
          }
          if (query.date && !isValidReportDate(query.date)) {
            return status(400, { code: 'INVALID_REPORT_DATE', message: 'วันที่รายงานไม่ถูกต้อง' })
          }
          const reportPeriod = query.period
          if (reportPeriod && !isSalesPeriod(reportPeriod)) {
            return status(400, { code: 'INVALID_REPORT_PERIOD', message: 'ช่วงเวลารายงานไม่ถูกต้อง' })
          }
          const selectedPeriod = reportPeriod && isSalesPeriod(reportPeriod) ? reportPeriod : null
          const range = query.date
            ? bangkokDayRange(query.date)
            : bangkokSalesPeriodRange(selectedPeriod ?? 'today', dependencies.now())
          const report = await dependencies.orders.listSales(
            range.start,
            range.end,
            query.page ?? 1,
            query.pageSize ?? 50,
          )
          return { ...report, date: query.date ?? null, period: selectedPeriod }
        })
        .get('/admin/sales/top-products', {
          query: t.Object({
            period: t.Optional(t.String({ maxLength: 10, minLength: 2 })),
          }),
        }, async ({ query }) => {
          const period = query.period ?? 'this_month'
          if (!isSalesPeriod(period)) {
            return status(400, {
              code: 'INVALID_SALES_PERIOD',
              message: 'ช่วงเวลารายงานไม่ถูกต้อง',
            })
          }
          const range = bangkokSalesPeriodRange(period, dependencies.now())
          const items = await dependencies.orders.listTopSellingProducts(
            range.start,
            range.end,
            10,
          )
          return {
            items,
            period,
            range: { endAt: range.end, startAt: range.start },
            timezone: 'Asia/Bangkok' as const,
          }
        })
        .get('/admin/costs/overview', () => dependencies.costing.listOverview())
        .post('/admin/costs/ingredients', {
          body: t.Object({
            name: t.String({ maxLength: 80, minLength: 1 }),
            unit: t.String({ maxLength: 10, minLength: 1 }),
          }),
        }, async ({ body, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidIngredientName(body.name) || !isIngredientUnit(body.unit)) {
            return status(400, INVALID_COSTING_INPUT)
          }

          try {
            return await dependencies.costing.createIngredient({
              name: normalizeIngredientName(body.name),
              unit: body.unit,
            })
          } catch (error) {
            if (isDatabaseConflict(error)) return status(409, INGREDIENT_NAME_EXISTS)
            throw error
          }
        })
        .patch('/admin/costs/ingredients/:id', {
          body: t.Object({
            name: t.String({ maxLength: 80, minLength: 1 }),
            unit: t.String({ maxLength: 10, minLength: 1 }),
          }),
          params: t.Object({ id: t.String() }),
        }, async ({ body, params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (
            !isValidUuid(params.id)
            || !isValidIngredientName(body.name)
            || !isIngredientUnit(body.unit)
          ) return status(400, INVALID_COSTING_INPUT)

          const existing = await dependencies.costing.getIngredient(params.id)
          if (!existing) return status(404, INGREDIENT_NOT_FOUND)

          try {
            return await dependencies.costing.updateIngredient(params.id, {
              name: normalizeIngredientName(body.name),
              unit: body.unit,
            })
          } catch (error) {
            // The database refuses the unit change too; this only turns it into
            // a Thai message instead of a 500.
            if (error instanceof IngredientUnitLockedError) {
              return status(409, INGREDIENT_UNIT_LOCKED)
            }
            if (isDatabaseConflict(error)) return status(409, INGREDIENT_NAME_EXISTS)
            throw error
          }
        })
        .post('/admin/costs/ingredients/:id/archive', {
          params: t.Object({ id: t.String() }),
        }, async ({ params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidUuid(params.id)) return status(400, INVALID_COSTING_INPUT)

          const existing = await dependencies.costing.getIngredient(params.id)
          if (!existing) return status(404, INGREDIENT_NOT_FOUND)
          // Archiving must not silently drop this ingredient's share of a live
          // menu's cost, which would inflate that menu's margin with no warning.
          if (existing.recipeProductCount > 0) return status(409, INGREDIENT_IN_USE)

          await dependencies.costing.archiveIngredient(params.id)
          return { ok: true }
        })
        .post('/admin/costs/ingredients/:id/restore', {
          params: t.Object({ id: t.String() }),
        }, async ({ params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidUuid(params.id)) return status(400, INVALID_COSTING_INPUT)

          try {
            await dependencies.costing.restoreIngredient(params.id)
            return { ok: true }
          } catch (error) {
            if (isDatabaseConflict(error)) return status(409, INGREDIENT_NAME_EXISTS)
            throw error
          }
        })
        .delete('/admin/costs/ingredients/:id', {
          params: t.Object({ id: t.String() }),
        }, async ({ params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidUuid(params.id)) return status(400, INVALID_COSTING_INPUT)

          const existing = await dependencies.costing.getIngredient(params.id)
          if (!existing || !existing.archivedAt) return status(404, INGREDIENT_NOT_FOUND)

          try {
            await dependencies.costing.deleteIngredient(params.id)
            return { ok: true }
          } catch (error) {
            // Purchase lots and recipe lines both reference the ingredient with
            // on delete restrict, so a report number can never change because
            // something was deleted.
            if (isDatabaseForeignKeyViolation(error)) return status(409, INGREDIENT_IN_USE)
            throw error
          }
        })
        .get('/admin/costs/purchases', {
          query: t.Object({
            ingredientId: t.Optional(t.String({ maxLength: 36, minLength: 36 })),
            month: t.Optional(t.String({ maxLength: 7, minLength: 7 })),
            page: t.Optional(t.Numeric({ maximum: 100_000, minimum: 1 })),
            pageSize: t.Optional(t.Numeric({ maximum: 100, minimum: 1 })),
          }),
        }, async ({ query }) => {
          const month = query.month ?? bangkokMonthKey(dependencies.now())
          if (!isValidReportMonth(month)) return status(400, INVALID_REPORT_MONTH)
          if (query.ingredientId && !isValidUuid(query.ingredientId)) {
            return status(400, INVALID_COSTING_INPUT)
          }

          const page = query.page ?? 1
          const pageSize = query.pageSize ?? 20
          if (!isValidPurchasePage(page, pageSize)) return status(400, INVALID_COSTING_INPUT)

          const range = bangkokMonthRange(month)
          return dependencies.costing.listPurchases(
            range.start,
            range.end,
            query.ingredientId ?? null,
            page,
            pageSize,
          )
        })
        .post('/admin/costs/purchases', {
          body: t.Object({
            ingredientId: t.String({ maxLength: 36, minLength: 36 }),
            note: t.Optional(t.Union([t.String({ maxLength: 160 }), t.Null()])),
            purchasedOn: t.String({ maxLength: 10, minLength: 10 }),
            quantity: t.Number({ maximum: 1_000_000, minimum: 0 }),
            totalCost: t.Number({ maximum: 9_999_999.99, minimum: 0 }),
          }),
        }, async ({ body, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          const note = normalizePurchaseNote(body.note ?? null)
          if (
            !isValidUuid(body.ingredientId)
            || !isValidReportDate(body.purchasedOn)
            || !isValidPurchaseQuantity(body.quantity)
            || !isValidPurchaseCost(body.totalCost)
            || !isValidPurchaseNote(note)
          ) return status(400, INVALID_COSTING_INPUT)

          const ingredient = await dependencies.costing.getIngredient(body.ingredientId)
          if (!ingredient) return status(404, INGREDIENT_NOT_FOUND)

          return dependencies.costing.createPurchase({
            ingredientId: body.ingredientId,
            note,
            purchasedOn: body.purchasedOn,
            quantity: body.quantity,
            totalCost: body.totalCost,
          })
        })
        .patch('/admin/costs/purchases/:id', {
          body: t.Object({
            ingredientId: t.String({ maxLength: 36, minLength: 36 }),
            note: t.Optional(t.Union([t.String({ maxLength: 160 }), t.Null()])),
            purchasedOn: t.String({ maxLength: 10, minLength: 10 }),
            quantity: t.Number({ maximum: 1_000_000, minimum: 0 }),
            totalCost: t.Number({ maximum: 9_999_999.99, minimum: 0 }),
          }),
          params: t.Object({ id: t.String() }),
        }, async ({ body, params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          const note = normalizePurchaseNote(body.note ?? null)
          if (
            !isValidUuid(params.id)
            || !isValidUuid(body.ingredientId)
            || !isValidReportDate(body.purchasedOn)
            || !isValidPurchaseQuantity(body.quantity)
            || !isValidPurchaseCost(body.totalCost)
            || !isValidPurchaseNote(note)
          ) return status(400, INVALID_COSTING_INPUT)

          const ingredient = await dependencies.costing.getIngredient(body.ingredientId)
          if (!ingredient) return status(404, INGREDIENT_NOT_FOUND)

          try {
            return await dependencies.costing.updatePurchase(params.id, {
              ingredientId: body.ingredientId,
              note,
              purchasedOn: body.purchasedOn,
              quantity: body.quantity,
              totalCost: body.totalCost,
            })
          } catch (error) {
            if (error instanceof PurchaseNotFoundError) return status(404, PURCHASE_NOT_FOUND)
            throw error
          }
        })
        .delete('/admin/costs/purchases/:id', {
          params: t.Object({ id: t.String() }),
        }, async ({ params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          if (!isValidUuid(params.id)) return status(400, INVALID_COSTING_INPUT)

          try {
            await dependencies.costing.deletePurchase(params.id)
            return { ok: true }
          } catch (error) {
            if (error instanceof PurchaseNotFoundError) return status(404, PURCHASE_NOT_FOUND)
            throw error
          }
        })
        .put('/admin/costs/products/:id/recipe', {
          body: t.Object({
            items: t.Array(t.Object({
              batchQuantity: t.Number({ maximum: 1_000_000, minimum: 0 }),
              batchYield: t.Integer({ maximum: 100_000, minimum: 1 }),
              ingredientId: t.String({ maxLength: 36, minLength: 36 }),
            }), { maxItems: 40 }),
          }),
          params: t.Object({ id: t.String() }),
        }, async ({ body, params, request }) => {
          if (!isTrustedMutationOrigin(request)) {
            return status(403, { code: 'INVALID_ORIGIN', message: 'คำขอไม่ถูกต้อง' })
          }
          // An empty array clears the recipe, which isValidRecipeItems rejects
          // on purpose so a partial write cannot pass as one.
          if (!isValidUuid(params.id)) return status(400, INVALID_COSTING_INPUT)
          if (body.items.length && !isValidRecipeItems(body.items)) {
            return status(400, INVALID_RECIPE)
          }

          try {
            return await dependencies.costing.setProductRecipe(params.id, body.items)
          } catch (error) {
            if (error instanceof InvalidRecipeError) return status(400, INVALID_RECIPE)
            throw error
          }
        })
        .get('/admin/reports/profit', {
          query: t.Object({
            date: t.Optional(t.String({ maxLength: 10, minLength: 10 })),
            month: t.Optional(t.String({ maxLength: 7, minLength: 7 })),
            period: t.Optional(t.String({ maxLength: 10, minLength: 2 })),
          }),
        }, async ({ query }) => {
          // Counted rather than XOR'd, so adding a third filter could not make
          // "neither" pass as "exactly one".
          const filters = [query.date, query.month, query.period].filter(Boolean)
          if (filters.length !== 1) return status(400, INVALID_REPORT_FILTER)
          if (query.date && !isValidReportDate(query.date)) {
            return status(400, { code: 'INVALID_REPORT_DATE', message: 'วันที่รายงานไม่ถูกต้อง' })
          }
          if (query.month && !isValidReportMonth(query.month)) {
            return status(400, INVALID_REPORT_MONTH)
          }
          if (query.period && !isSalesPeriod(query.period)) {
            return status(400, { code: 'INVALID_REPORT_PERIOD', message: 'ช่วงเวลารายงานไม่ถูกต้อง' })
          }

          const period = query.period && isSalesPeriod(query.period) ? query.period : null
          const range = query.date
            ? bangkokDayRange(query.date)
            : query.month
              ? bangkokMonthRange(query.month)
              : bangkokSalesPeriodRange(period ?? 'today', dependencies.now())
          const summary = await dependencies.costing.profitSummary(range.start, range.end)

          return {
            ...summary,
            date: query.date ?? null,
            month: query.month ?? null,
            period,
            range: { endAt: range.end, startAt: range.start },
            timezone: 'Asia/Bangkok' as const,
          }
        })
        .get('/admin/reports/profit/monthly', {
          query: t.Object({
            months: t.Optional(t.Numeric({ maximum: 36, minimum: 1 })),
          }),
        }, async ({ query }) => {
          const range = bangkokTrailingMonthsRange(query.months ?? 6, dependencies.now())
          const months = await dependencies.costing.listMonthlyProfit(range.start, range.end)

          return {
            months,
            range: { endAt: range.end, startAt: range.start },
            timezone: 'Asia/Bangkok' as const,
          }
        }))
}

export const app = createApp()
export type App = typeof app
