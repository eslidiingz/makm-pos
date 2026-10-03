import { treaty } from '@elysia/eden'
import type { App } from '@/server/app'

/** Type-safe client for Elysia routes. Use from browser components. */
export const api = treaty<App>('/api')
