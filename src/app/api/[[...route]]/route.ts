import { app } from '@/server/app'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const handle = (request: Request) => app.fetch(request)

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = handle
