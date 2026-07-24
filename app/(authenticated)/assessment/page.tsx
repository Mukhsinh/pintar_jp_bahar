import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AssessmentPageContent from '@/components/assessment/AssessmentPageContent'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getAvailablePeriods(supabase: any): Promise<string[]> {
  try {
    // 1. Fetch periods from t_pool
    const { data: poolData } = await supabase
      .from('t_pool')
      .select('period')
      .order('period', { ascending: false })

    const periodsSet = new Set<string>()
    poolData?.forEach((item: any) => {
      if (item.period) periodsSet.add(item.period)
    })

    // 2. Fetch distinct periods from t_kpi_assessments
    const { data: assData } = await supabase
      .from('t_kpi_assessments')
      .select('period')
      .limit(200)

    assData?.forEach((item: any) => {
      if (item.period) periodsSet.add(item.period)
    })

    // 3. Fallback: Always include current period (YYYY-MM)
    const currentMonth = new Date().toISOString().slice(0, 7)
    periodsSet.add(currentMonth)

    return Array.from(periodsSet).sort((a, b) => b.localeCompare(a))
  } catch (error) {
    console.error('Exception in getAvailablePeriods:', error)
    return [new Date().toISOString().slice(0, 7)]
  }
}

export default async function AssessmentPage() {
  try {
    const supabase = await createClient()

    // Get user first, then fetch periods using the same client (avoids extra auth.getUser)
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      redirect('/login')
    }

    const availablePeriods = await getAvailablePeriods(supabase)


    // Get current user's employee record with error handling
    let { data: currentEmployee, error: employeeError } = await supabase
      .from('m_employees')
      .select('id, role, unit_id, full_name')
      .eq('user_id', user.id)
      .maybeSingle()

    const authRole = user.app_metadata?.role || user.user_metadata?.role
    const isSuperAdmin = authRole === 'superadmin' || user.email === 'admin@sungaibahar.com'

    if (employeeError || !currentEmployee) {
      if (isSuperAdmin) {
        currentEmployee = {
          id: user.id,
          full_name: user.user_metadata?.full_name || 'Super Administrator',
          role: 'superadmin',
          unit_id: '0'
        }
      } else {
        console.error('Employee lookup error:', employeeError)
        redirect('/forbidden')
      }
    }

    // Use database role if defined, otherwise fallback to Auth metadata for superadmin detection
    if (!currentEmployee.role && isSuperAdmin) {
      currentEmployee.role = 'superadmin'
    }

    // Check if user has assessment permissions
    if (!['superadmin', 'unit_manager'].includes(currentEmployee.role)) {
      redirect('/forbidden')
    }

    return (
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Penilaian KPI</h1>
          <p className="text-gray-600">
            Kelola penilaian kinerja pegawai berdasarkan indikator KPI yang telah dikonfigurasi
          </p>
        </div>

        <Suspense fallback={
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        }>
          <AssessmentPageContent
            currentEmployee={currentEmployee}
            availablePeriods={availablePeriods}
          />
        </Suspense>
      </div>
    )
  } catch (error: any) {
    console.error('Assessment page error:', error)
    redirect('/login')
  }
}