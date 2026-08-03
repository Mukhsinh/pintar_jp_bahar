import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import {
  isPublicRoute,
  isLegacyRoute,
  getLegacyRedirectPath,
  isRouteAllowed
} from '@/lib/services/route-config.service'
import type { Role } from '@/lib/services/rbac.service'

// OPTIMIZED: LRU Cache with better memory management
class LRUCache<T> {
  private cache = new Map<string, { value: T; timestamp: number }>()
  private maxSize: number
  private ttl: number

  constructor(maxSize = 500, ttl = 5 * 60 * 1000) {
    this.maxSize = maxSize
    this.ttl = ttl
  }

  get(key: string): T | null {
    const item = this.cache.get(key)
    if (!item) return null

    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key)
      return null
    }

    // Move to end (LRU)
    this.cache.delete(key)
    this.cache.set(key, item)
    return item.value
  }

  set(key: string, value: T): void {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) this.cache.delete(firstKey)
    }

    this.cache.set(key, { value, timestamp: Date.now() })
  }

  clear(): void {
    this.cache.clear()
  }
}

// Optimized cache instance with enhanced settings
const CACHE_TTL = 15 * 60 * 1000 // 15 minutes TTL (increased from 5 minutes)
const MAX_CACHE_SIZE = 1000 // Increased cache size

const employeeCache = new LRUCache<{
  role: Role
  is_active: boolean
}>(MAX_CACHE_SIZE, CACHE_TTL)

// Background cleanup (runs less frequently)
let lastCleanup = 0
const CLEANUP_INTERVAL = 10 * 60 * 1000 // 10 minutes

function shouldCleanup(): boolean {
  const now = Date.now()
  if (now - lastCleanup > CLEANUP_INTERVAL) {
    lastCleanup = now
    return true
  }
  return false
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  try {
    // 0. Skip middleware for static assets, favicon, health check, and settings API
    if (
      pathname.startsWith('/_next') ||
      pathname.startsWith('/favicon') ||
      pathname.startsWith('/icon') ||
      pathname.includes('.') ||
      pathname === '/api/health' ||
      pathname === '/api/settings'
    ) {
      return response
    }

    // Background cleanup (only occasionally)
    if (shouldCleanup()) {
      employeeCache.clear()
    }

    // 1. Create supabase client with modern getAll / setAll
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            response = NextResponse.next({
              request,
            })
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    // IMPORTANT: Verify user session using getUser()
    // getSession() is insecure in middleware and can cause refresh token errors
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    // If there's an error and it's related to invalid/missing tokens, 
    // we let it be handled by the session check below
    if (userError) {
      // Don't log expected auth errors to keep console clean
      if (!userError.message.includes('Refresh Token Not Found')) {
        console.warn('[MIDDLEWARE] Auth check:', userError.message)
      }
    }

    const session = user ? { user } : null


    // 2. Check if public route (login, reset-password, forbidden)
    if (isPublicRoute(pathname)) {
      return response
    }

    // 3. Check for legacy routes and redirect permanently
    if (isLegacyRoute(pathname)) {
      const newPath = getLegacyRedirectPath(pathname)
      if (newPath) {
        const url = new URL(newPath, request.url)
        url.search = request.nextUrl.search
        return NextResponse.redirect(url, 301)
      }
    }

    // 4. Validate session
    if (!session) {
      // For API routes, return JSON 401 Unauthorized instead of redirect HTML
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Only redirect to login if not already on login page
      if (pathname !== '/login') {
        const loginUrl = new URL('/login', request.url)
        const redirectResponse = NextResponse.redirect(loginUrl)

        // Clear auth cookies
        const cookiesToClear = ['sb-access-token', 'sb-refresh-token', 'supabase-auth-token', 'sb-auth-token']
        cookiesToClear.forEach(cookieName => {
          redirectResponse.cookies.set(cookieName, '', { maxAge: 0, path: '/' })
        })

        return redirectResponse
      }
      // If already on login page, just continue
      return response
    }

    // 5. Get employee data and role (with optimized caching)
    let employeeData = employeeCache.get(session.user.id)

    // Check if cached role matches auth metadata role
    // If not, invalidate cache to pick up the updated role
    const sessionMetadataRole = session.user.user_metadata?.role
    if (employeeData && sessionMetadataRole && employeeData.role !== sessionMetadataRole) {
      employeeData = null // Invalidate cache
    }

    if (!employeeData) {
      // 1. Check auth metadata first (it's the source of truth for superadmins)
      const userMeta = session.user.user_metadata || {}
      const appMeta = session.user.app_metadata || {}

      const rawRole = (appMeta.role || userMeta.role || '').toString().toLowerCase()
      const isAdmin = rawRole === 'superadmin' || rawRole === 'admin' || session.user.email === 'admin@sungaibahar.com'

      if (isAdmin) {
        employeeData = {
          role: 'superadmin' as Role,
          is_active: true
        }
        employeeCache.set(session.user.id, employeeData)
      } else {
        // 2. Fetch employee record for others
        const { data: employee, error: employeeError } = await supabase
          .from('m_employees')
          .select('role, is_active')
          .eq('user_id', session.user.id)
          .limit(1)
          .maybeSingle()

        if (employeeError || !employee) {
          console.error('[MIDDLEWARE] User not found in employees and no admin metadata:', session.user.email)
          if (pathname.startsWith('/api/')) {
            return NextResponse.json({ error: 'User record not found' }, { status: 404 })
          }
          const loginUrl = new URL('/login', request.url)
          loginUrl.searchParams.set('error', 'user_not_found')
          return NextResponse.redirect(loginUrl)
        }

        employeeData = {
          role: (employee.role || 'employee') as Role,
          is_active: !!employee.is_active
        }
        employeeCache.set(session.user.id, employeeData)
      }
    }

    // 6. Check if employee is active
    if (!employeeData.is_active) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
      }
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('error', 'inactive')

      const redirectResponse = NextResponse.redirect(loginUrl)
      const cookiesToClear = ['sb-access-token', 'sb-refresh-token', 'supabase-auth-token', 'sb-auth-token']
      cookiesToClear.forEach(cookieName => {
        redirectResponse.cookies.set(cookieName, '', { maxAge: 0, path: '/' })
      })

      return redirectResponse
    }

    // 7. Check route authorization
    // Superadmins can bypass route checks (they have full access)
    if (employeeData.role !== 'superadmin' && !pathname.startsWith('/api/') && !isRouteAllowed(pathname, employeeData.role)) {
      const forbiddenUrl = new URL('/forbidden', request.url)
      return NextResponse.redirect(forbiddenUrl)
    }

    // 8. Set security headers
    response.headers.set('X-Frame-Options', 'DENY')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.headers.set('X-XSS-Protection', '1; mode=block')

    return response
  } catch (error: any) {
    console.error('Middleware error:', error)

    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    // On any error, redirect to login and clear cookies
    const loginUrl = new URL('/login', request.url)
    const redirectResponse = NextResponse.redirect(loginUrl)
    const cookiesToClear = ['sb-access-token', 'sb-refresh-token', 'supabase-auth-token', 'sb-auth-token']
    cookiesToClear.forEach(cookieName => {
      redirectResponse.cookies.set(cookieName, '', { maxAge: 0, path: '/' })
    })

    return redirectResponse
  }
}

export const config = {
  matcher: [
    // Protected routes
    '/dashboard/:path*',
    '/units/:path*',
    '/users/:path*',
    '/pegawai/:path*',
    '/kpi-config/:path*',
    '/pool/:path*',
    '/realization/:path*',
    '/assessment/:path*',
    '/reports/:path*',
    '/audit/:path*',
    '/settings/:path*',
    '/profile/:path*',
    '/notifications/:path*',
    // API routes
    '/api/:path*',
    // Legacy routes for redirect
    '/admin/:path*',
    '/manager/:path*',
    '/employee/:path*',
  ],
}