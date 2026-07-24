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
  role?: string
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

    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period')
    const status = searchParams.get('status')
    const requestedUnitId = searchParams.get('unit_id')

    if (!period) {
      return NextResponse.json({ error: 'Period is required' }, { status: 400 })
    }

    // STUCT UNIT ISOLATION & FILTERING
    const userRole = currentEmployee.role
    const userUnitId = currentEmployee.unit_id

    // 1. First attempt: Get data from v_assessment_status view
    let statusQuery = adminClient
      .from('v_assessment_status')
      .select('*')
      .eq('period', period)

    if (userRole === 'unit_manager') {
      if (!userUnitId) {
        return NextResponse.json({ error: 'Unit ID not found for manager profile' }, { status: 403 })
      }
      statusQuery = statusQuery.eq('unit_id', userUnitId)
    } else if (userRole === 'superadmin') {
      if (requestedUnitId && requestedUnitId !== 'all') {
        statusQuery = statusQuery.eq('unit_id', requestedUnitId)
      }
    } else {
      if (userUnitId && userUnitId !== '0') {
        statusQuery = statusQuery.eq('unit_id', userUnitId)
      } else if (userRole !== 'superadmin') {
        return NextResponse.json({ error: 'Unauthorized access level' }, { status: 403 })
      }
    }

    if (status && ['Belum Dinilai', 'Sebagian', 'Selesai'].includes(status)) {
      statusQuery = statusQuery.eq('status', status)
    }

    const { data: rawEmployees, error: statusError } = await statusQuery.order('full_name')

    if (statusError) {
      console.error('View fetch error:', statusError)
    }

    let employeesData: AssessmentStatus[] = (rawEmployees || []) as AssessmentStatus[]

    // 2. Fallback: If view returns no rows (e.g. period not yet in t_pool), query m_employees directly!
    if (employeesData.length === 0) {
      // Get SUPERADMIN unit ID to exclude
      const { data: adminUnit } = await adminClient
        .from('m_units')
        .select('id')
        .or('code.ilike.ADMIN,name.ilike.SUPERADMIN')
        .maybeSingle()
      const adminUnitId = adminUnit?.id

      let empQuery = adminClient
        .from('m_employees')
        .select(`
          id,
          full_name,
          unit_id,
          role,
          m_units!inner (
            name
          )
        `)
        .eq('is_active', true)
        .neq('role', 'superadmin')

      // Exclude SUPERADMIN unit
      if (adminUnitId) {
        empQuery = empQuery.neq('unit_id', adminUnitId)
      }

      if (userRole === 'unit_manager' && userUnitId) {
        empQuery = empQuery.eq('unit_id', userUnitId)
      } else if (userRole === 'superadmin' && requestedUnitId && requestedUnitId !== 'all') {
        empQuery = empQuery.eq('unit_id', requestedUnitId)
      }

      const { data: directEmps, error: directErr } = await empQuery.order('full_name')

      if (!directErr && directEmps) {
        // Get indicator counts per unit
        const { data: indicators } = await adminClient
          .from('m_kpi_indicators')
          .select('id, m_kpi_categories!inner(unit_id)')
          .eq('is_active', true)

        const indicatorCountMap: Record<string, number> = {}
        indicators?.forEach((ind: any) => {
          const uId = ind.m_kpi_categories?.unit_id
          if (uId) indicatorCountMap[uId] = (indicatorCountMap[uId] || 0) + 1
        })

        // Get existing assessments for this period
        const { data: existingAssessments } = await adminClient
          .from('t_kpi_assessments')
          .select('employee_id, indicator_id')
          .eq('period', period)

        const assessedCountMap: Record<string, Set<string>> = {}
        existingAssessments?.forEach((ass: any) => {
          if (!assessedCountMap[ass.employee_id]) {
            assessedCountMap[ass.employee_id] = new Set()
          }
          assessedCountMap[ass.employee_id].add(ass.indicator_id)
        })

        employeesData = directEmps.map((emp: any) => {
          const totalInd = indicatorCountMap[emp.unit_id] || 0
          const assessedInd = assessedCountMap[emp.id]?.size || 0
          let empStatus = 'Belum Dinilai'
          if (assessedInd > 0) {
            empStatus = (totalInd > 0 && assessedInd >= totalInd) ? 'Selesai' : 'Sebagian'
          }
          const completionPct = totalInd > 0 ? Math.round((assessedInd / totalInd) * 100) : 0

          return {
            employee_id: emp.id,
            full_name: emp.full_name,
            unit_id: emp.unit_id,
            unit_name: (emp.m_units as any)?.name || '-',
            period: period,
            total_indicators: totalInd,
            assessed_indicators: assessedInd,
            status: empStatus,
            completion_percentage: completionPct,
            role: emp.role
          }
        })

        if (status && ['Belum Dinilai', 'Sebagian', 'Selesai'].includes(status)) {
          employeesData = employeesData.filter(e => e.status === status)
        }
      }
    }

    // Secondary filter: Exclude superadmins AND employees from SUPERADMIN unit
    const { data: adminUnitInfo } = await adminClient
      .from('m_units')
      .select('id, name')
      .or('code.ilike.ADMIN,name.ilike.SUPERADMIN')
      .maybeSingle()

    const filteredResults = employeesData.filter((emp: any) => {
      if (emp.role === 'superadmin') return false
      // Exclude SUPERADMIN unit by id or name
      if (adminUnitInfo && emp.unit_id === adminUnitInfo.id) return false
      if (emp.unit_name?.toUpperCase() === 'SUPERADMIN') return false
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