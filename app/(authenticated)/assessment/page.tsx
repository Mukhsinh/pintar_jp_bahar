import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AssessmentPageContent from '@/components/assessment/AssessmentPageContent'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Import function secara langsung untuk menghindari module resolution issue
async function getAvailablePeriods(): Promise<string[]> {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('t_pool')
      .select('period')
      .in('status', ['approved', 'distributed'])
      .order('period', { ascending: false })

    if (error) {
      console.error('Error fetching periods:', error)
      return []
    }

    return data?.map(item => item.period) || []
  } catch (error) {
    console.error('Exception in getAvailablePeriods:', error)
    return []
  }
}

export default async function AssessmentPage() {
  try {
    const supabase = await createClient()

    // Optimize data fetching using Promise.all
    const [authResponse, availablePeriods] = await Promise.all([
      supabase.auth.getUser(),
      getAvailablePeriods()
    ])

    const { data: { user }, error: authError } = authResponse
    if (authError || !user) {
      redirect('/login')
    }

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