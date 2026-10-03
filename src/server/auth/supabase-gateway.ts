import type { Session, User } from '@supabase/supabase-js'

import { resolveOwnerAuthEmail } from '@/server/auth/owner-identity'
import { getSupabaseAdminClient, getSupabaseAuthClient } from '@/server/supabase'
import type { AuthGateway, AuthResult, AuthSession, AuthUser } from '@/server/auth/types'

function mapUser(user: User): AuthUser {
  return {
    appMetadata: user.app_metadata ?? {},
    id: user.id,
    phone: user.phone ?? null,
  }
}

function mapSession(session: Session): AuthSession {
  return {
    accessToken: session.access_token,
    expiresIn: session.expires_in,
    refreshToken: session.refresh_token,
  }
}

function mapResult(session: Session | null, user: User | null): AuthResult | null {
  if (!session || !user) return null
  return { session: mapSession(session), user: mapUser(user) }
}

export class SupabaseAuthGateway implements AuthGateway {
  async signIn(phone: string, password: string) {
    const email = resolveOwnerAuthEmail(phone)
    if (!email) return null

    const client = getSupabaseAuthClient()
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error) return null
    return mapResult(data.session, data.user)
  }

  async getUser(accessToken: string) {
    const client = getSupabaseAuthClient()
    const { data, error } = await client.auth.getUser(accessToken)
    return error || !data.user ? null : mapUser(data.user)
  }

  async refresh(refreshToken: string) {
    const client = getSupabaseAuthClient()
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken })
    if (error) return null
    return mapResult(data.session, data.user)
  }

  async changePassword(phone: string, currentPassword: string, newPassword: string) {
    const email = resolveOwnerAuthEmail(phone)
    if (!email) return null

    const client = getSupabaseAuthClient()
    const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({
      email,
      password: currentPassword,
    })
    if (signInError || !signedIn.session || !signedIn.user) return null

    const { data: updated, error: updateError } = await client.auth.updateUser({
      password: newPassword,
    })
    if (updateError || !updated.user) return null

    const admin = getSupabaseAdminClient()
    const { data: metadataUpdated, error: metadataError } = await admin.auth.admin.updateUserById(
      updated.user.id,
      {
        app_metadata: {
          ...updated.user.app_metadata,
          must_change_password: false,
          role: 'platform_owner',
        },
      },
    )
    if (metadataError || !metadataUpdated.user) {
      throw new Error('Unable to update owner authentication metadata.')
    }

    return {
      session: mapSession(signedIn.session),
      user: mapUser(metadataUpdated.user),
    }
  }

  async revoke(accessToken: string, refreshToken: string) {
    const client = getSupabaseAuthClient()
    const { error: sessionError } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    if (sessionError) return
    await client.auth.signOut({ scope: 'local' })
  }
}
