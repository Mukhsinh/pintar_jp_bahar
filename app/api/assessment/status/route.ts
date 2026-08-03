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

async function getAssessmentStatus(supabase: any, unitIdFilter: string | null, period: string): Promise<AssessmentStatus[]> {
  let query = supabase
    .from('v_assessment_status')
    .select('*')
    .eq('period', period)

  if (unitIdFilter && unitIdFilter !== '0') {
    query = query.eq('unit_id', unitIdFilter)
  }

  const { data, error } = await query.order('full_name').range(0, 9999)

  let result: AssessmentStatus[] = (data || []).filter((emp: any) =>
    emp.unit_code !== 'ADMIN' &&
    emp.unit_name !== 'SUPERADMIN' &&
    emp.role !== 'superadmin'
  )

  // Fallback if view returns no rows
  if (result.length === 0) {
    let empQuery = supabase
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

    if (unitIdFilter && unitIdFilter !== '0') {
      empQuery = empQuery.eq('unit_id', unitIdFilter)
    }

    const { data: directEmps } = await empQuery.order('full_name')

    if (directEmps && directEmps.length > 0) {
      const { data: indicators } = await supabase
        .from('m_kpi_indicators')
        .select('id, m_kpi_categories!inner(unit_id)')
        .eq('is_active', true)

      const indicatorCountMap: Record<string, number> = {}
      indicators?.forEach((ind: any) => {
        const uId = ind.m_kpi_categories?.unit_id
        if (uId) indicatorCountMap[uId] = (indicatorCountMap[uId] || 0) + 1
      })

      const { data: existingAssessments } = await supabase
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

      result = directEmps.map((emp: any) => {
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
    }
  }

  return result
}

import { getAuthenticatedUser } from '@/lib/supabase/auth-helper'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Check authentication
    const user = await getAuthenticatedUser(supabase, request)
    if (!user) {
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
