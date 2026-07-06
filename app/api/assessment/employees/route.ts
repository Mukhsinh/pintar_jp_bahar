import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

interface AssessmentStatus {
  employee_id: string
  full_name: string
  unit_id: string
  unit_name: string
  period: string
  total_indicators: number
  assessed_indicators: number
  status: string
  completion_percentage: number
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      console.error('Authentication error:', authError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Use admin client to bypass RLS for employee lookup
    const adminClient = await createAdminClient()

    // Try by user_id first
    let currentEmployee: any = null
    const { data: byUserId } = await adminClient
      .from('m_employees')
      .select('id, role, unit_id, full_name')
      .eq('user_id', user.id)
      .maybeSingle()

    if (byUserId) {
      currentEmployee = byUserId
    } else {
      // NOTE: Fallback by email is disabled because m_employees lacks an email column
      // If we ever add an email column to m_employees, we can re-enable this with case-insensitive matching

      const appRole = user.app_metadata?.role
      const userRole = user.user_metadata?.role
      const email = user.email

      const isSuperAdmin =
        appRole === 'superadmin' ||
        userRole === 'superadmin' ||
        email === 'admin@sungaibahar.com'

      if (isSuperAdmin) {
        currentEmployee = {
          id: user.id,
          full_name: 'Super Administrator',
          role: 'superadmin',
          unit_id: '0'
        }
      } else {
        console.error('No employee record linked to user id:', user.id)
        return NextResponse.json({ error: 'Employee record not found. Please contact admin to link your account.' }, { status: 404 })
      }
    }

    console.log('API Assessment: Identified user as:', currentEmployee.full_name, 'with role:', currentEmployee.role)

    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period')
    const status = searchParams.get('status')
    const requestedUnitId = searchParams.get('unit_id')

    if (!period) {
      return NextResponse.json({ error: 'Period is required' }, { status: 400 })
    }

    // Get data directly from v_assessment_status view
    let statusQuery = adminClient
      .from('v_assessment_status')
      .select('*')
      .eq('period', period)

    // STUCT UNIT ISOLATION & FILTERING
    const userRole = currentEmployee.role
    const userUnitId = currentEmployee.unit_id

    if (userRole === 'unit_manager') {
      // Unit managers are STRICTLY limited to their own unit
      if (!userUnitId) {
        return NextResponse.json({ error: 'Unit ID not found for manager profile' }, { status: 403 })
      }
      statusQuery = statusQuery.eq('unit_id', userUnitId)
    } else if (userRole === 'superadmin') {
      // Superadmins can see all or filter by requested unit
      if (requestedUnitId && requestedUnitId !== 'all') {
        statusQuery = statusQuery.eq('unit_id', requestedUnitId)
      }
    } else {
      // Employees or other roles should also be limited to their own unit if they somehow access this
      // Or we can just reject if not superadmin/manager
      if (userUnitId && userUnitId !== '0') {
        statusQuery = statusQuery.eq('unit_id', userUnitId)
      } else if (userRole !== 'superadmin') {
        // Fallback safety: if role is unknown and unit is unknown, limit to nothing or error
        return NextResponse.json({ error: 'Unauthorized access level' }, { status: 403 })
      }
    }

    if (status && ['Belum Dinilai', 'Sebagian', 'Selesai'].includes(status)) {
      statusQuery = statusQuery.eq('status', status)
    }

    const { data: rawEmployees, error: statusError } = await statusQuery.order('full_name')

    if (statusError) {
      console.error('View fetch error:', statusError)
      return NextResponse.json({ error: statusError.message }, { status: 500 })
    }

    // Secondary filter: Ensure superadmins are not in the list for anyone (view already does this but double check)
    // and that the unit isolation held (double check)
    const filteredResults = (rawEmployees || []).filter((emp: any) => {
      // Hide superadmins
      if (emp.role === 'superadmin') return false

      // Double check unit isolation for unit managers
      if (userRole === 'unit_manager' && emp.unit_id !== userUnitId) {
        return false
      }

      return true
    })

    return NextResponse.json({ employees: filteredResults })
  } catch (error) {
    console.error('Assessment employees GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch employees for assessment' },
      { status: 500 }
    )
  }
}