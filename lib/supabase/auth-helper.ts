import { createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

/**
 * Safely decodes a Supabase Auth JWT token payload without network calls.
 * Used as a fallback when Supabase Cloud Auth API hits 429 Rate Limits.
 */
function decodeJwtPayload(token: string) {
    try {
        const parts = token.split('.')
        if (parts.length !== 3) return null
        const base64Url = parts[1]
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
        const jsonPayload = Buffer.from(base64, 'base64').toString('utf8')
        const payload = JSON.parse(jsonPayload)

        // Check token expiration (give 30 sec leeway)
        if (payload.exp && (payload.exp * 1000) < (Date.now() - 30000)) {
            return null // Expired token
        }
        if (!payload.sub) return null

        return {
            id: payload.sub,
            email: payload.email || '',
            user_metadata: payload.user_metadata || {},
            app_metadata: payload.app_metadata || {},
            role: payload.role || payload.app_metadata?.role || payload.user_metadata?.role
        }
    } catch (e) {
        return null
    }
}

/**
 * Extracts raw access token from request cookies
 */
function extractTokenFromCookies(cookieHeader?: string | null, cookieStoreAll?: Array<{ name: string; value: string }>) {
    // Try cookieStore array first
    if (cookieStoreAll && cookieStoreAll.length > 0) {
        // Look for sb-access-token or sb-*-auth-token
        const authCookie = cookieStoreAll.find(c => c.name.includes('auth-token') || c.name.includes('access-token'))
        if (authCookie && authCookie.value) {
            // Chunked cookie or JSON payload
            if (authCookie.value.startsWith('base64-')) {
                try {
                    const raw = Buffer.from(authCookie.value.replace('base64-', ''), 'base64').toString('utf8')
                    const parsed = JSON.parse(raw)
                    return parsed.access_token || parsed[0]
                } catch (e) {
                    // ignore
                }
            }
            if (authCookie.value.startsWith('{') || authCookie.value.startsWith('[')) {
                try {
                    const parsed = JSON.parse(authCookie.value)
                    return parsed.access_token || parsed[0]
                } catch (e) {
                    // ignore
                }
            }
            return authCookie.value
        }
    }

    // Parse raw cookie header string
    if (cookieHeader) {
        const cookiesArr = cookieHeader.split(';')
        for (const c of cookiesArr) {
            const [name, val] = c.trim().split('=')
            if (name && (name.includes('auth-token') || name.includes('access-token'))) {
                const decodedVal = decodeURIComponent(val || '')
                if (decodedVal.startsWith('base64-')) {
                    try {
                        const raw = Buffer.from(decodedVal.replace('base64-', ''), 'base64').toString('utf8')
                        const parsed = JSON.parse(raw)
                        return parsed.access_token || parsed[0]
                    } catch (e) {
                        // ignore
                    }
                }
                if (decodedVal.startsWith('{') || decodedVal.startsWith('[')) {
                    try {
                        const parsed = JSON.parse(decodedVal)
                        return parsed.access_token || parsed[0]
                    } catch (e) {
                        // ignore
                    }
                }
                return decodedVal
            }
        }
    }

    return null
}

/**
 * Robustly retrieves the authenticated user for API routes.
 * Prevents false 401 Unauthorized errors caused by concurrent token refresh race conditions (429 Too Many Requests).
 */
export async function getAuthenticatedUser(supabase: any, request?: Request) {
    // Attempt 1: Standard getUser()
    try {
        const { data: { user }, error } = await supabase.auth.getUser()
        if (user && !error) return user
    } catch (e) {
        // ignore
    }

    // Attempt 2: getSession() fallback
    try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) return session.user
    } catch (e) {
        // ignore
    }

    // Attempt 3: Authorization header fallback via Admin Client
    if (request) {
        const authHeader = request.headers.get('Authorization') || request.headers.get('authorization')
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace(/^Bearer\s+/i, '').trim()
            if (token) {
                try {
                    const adminClient = await createAdminClient()
                    const { data: { user } } = await adminClient.auth.getUser(token)
                    if (user) return user
                } catch (e) {
                    // Fallback to local JWT decode
                    const decoded = decodeJwtPayload(token)
                    if (decoded) return decoded
                }
            }
        }
    }

    // Attempt 4: Local JWT decoding from request cookies (Bypasses Supabase Cloud 429 Rate Limits entirely)
    try {
        let cookieStoreAll: Array<{ name: string; value: string }> = []
        try {
            const cookieStore = await cookies()
            cookieStoreAll = cookieStore.getAll()
        } catch (e) {
            // ignore if outside Next.js async storage context
        }

        const cookieHeader = request?.headers?.get('cookie')
        const token = extractTokenFromCookies(cookieHeader, cookieStoreAll)
        if (token) {
            const decodedUser = decodeJwtPayload(token)
            if (decodedUser) {
                return decodedUser
            }
        }
    } catch (e) {
        // ignore
    }

    return null
}
