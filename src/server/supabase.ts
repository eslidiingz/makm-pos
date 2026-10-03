import { createClient } from '@supabase/supabase-js'

function getSupabaseUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL.')
  return url
}

export function getSupabaseAuthClient() {
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!publishableKey) {
    throw new Error('Missing SUPABASE_PUBLISHABLE_KEY.')
  }

  return createClient(getSupabaseUrl(), publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

export function getSupabaseAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.')

  return createClient(getSupabaseUrl(), serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Service-role database client. Never import this module into client code. */
export const getSupabaseServerClient = getSupabaseAdminClient
