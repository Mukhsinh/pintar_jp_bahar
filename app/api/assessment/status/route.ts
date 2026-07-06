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

async function getAssessmentStatus(supabase: any, unitIdFilter: string | null, period: string): Promise<AssessmentStatus[]> {
  let query = supabase
    .from('v_assessment_status')
    .select('*')
    .eq('period', period)

  if (unitIdFilter && unitIdFilter !== '0') {
    query = query.eq('unit_id', unitIdFilter)
  }

  const { data, error } = await query.order('full_name').range(0, 9999)
  if (error) throw error

  // Filter out ADMIN unit (standard isolation)
  return (data || []).filter((emp: any) =>
    emp.unit_code !== 'ADMIN' &&
    emp.unit_name !== 'SUPERADMIN' &&
    emp.role !== 'superadmin'
  )
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const appRole = user.app_metadata?.role
    const userRole = user.user_metadata?.role
    const email = user.email

    const isSuperAdmin =
      appRole === 'superadmin' ||
      userRole === 'superadmin' ||
      email === 'admin@sungaibahar.com'

    // Use admin client for superadmin to bypass RLS, otherwise regular client
    const fetchClient = isSuperAdmin ? await createAdminClient() : supabase

    // Get current user's employee record
    let { data: currentEmployee } = await fetchClient
      .from('m_employees')
      .select('id, role, unit_id, full_name')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!currentEmployee) {
      if (isSuperAdmin) {
        currentEmployee = {
          id: user.id,
          full_name: 'Super Administrator',
          role: 'superadmin',
          unit_id: '0'
        }
      } else {
        return NextResponse.json({ error: 'Employee record not found. Please contact admin to link your account.' }, { status: 404 })
      }
    }

    // STRICT ROLE OVERRIDE: 
    // If the database says they are a unit_manager, we MUST respect that role
    // even if Auth metadata says superadmin, for proper unit isolation.
    // However, if database role is not defined but Auth metadata says superadmin, use that.
    const effectiveRole = currentEmployee.role || (isSuperAdmin ? 'superadmin' : 'employee')
    const effectiveUnitId = currentEmployee.unit_id

    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employee_id')
    const period = searchParams.get('period')
    const requestedUnitId = searchParams.get('unit_id')

    if (!period) {
      return NextResponse.json({ error: 'Period is required' }, { status: 400 })
    }

    if (employeeId) {
      // Authorization check for unit managers
      if (effectiveRole === 'unit_manager') {
        const { data: targetEmployee } = await supabase
          .from('m_employees')
          .select('unit_id')
          .eq('id', employeeId)
          .single()

        if (!targetEmployee || targetEmployee.unit_id !== effectiveUnitId) {
          return NextResponse.json(
            { error: 'You can only view status for employees in your unit' },
            { status: 403 }
          )
        }
      }

      // Get status for specific employee
      const statuses = await getAssessmentStatus(fetchClient, effectiveRole === 'unit_manager' ? effectiveUnitId : null, period)
      const employeeStatus = statuses.find(s => s.employee_id === employeeId)

      if (!employeeStatus) {
        return NextResponse.json({ error: 'Employee status not found' }, { status: 404 })
      }

      return NextResponse.json({ status: employeeStatus })
    } else {
      // Get status matching unit filter
      let unitIdFilter = effectiveRole === 'unit_manager' ? effectiveUnitId : null

      // Allow superadmin to override unit filter via query param
      if (effectiveRole === 'superadmin' && requestedUnitId && requestedUnitId !== 'all') {
        unitIdFilter = requestedUnitId
      }

      const statuses = await getAssessmentStatus(fetchClient, unitIdFilter, period)

      // Calculate summary statistics
      const summary = {
        total_employees: statuses.length,
        completed: statuses.filter(s => s.status === 'Selesai').length,
        started: statuses.filter(s => s.assessed_indicators > 0).length,
        partial: statuses.filter(s => s.status === 'Sebagian').length,
        not_started: statuses.filter(s => s.assessed_indicators === 0).length,
        completion_rate: statuses.length > 0
          ? Math.round((statuses.filter(s => s.status === 'Selesai').length / statuses.length) * 100)
          : 0
      }

      return NextResponse.json({
        statuses,
        summary
      })
    }
  } catch (error: any) {
    console.error('Assessment status GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch assessment status' },
      { status: 500 }
    )
  }
}
