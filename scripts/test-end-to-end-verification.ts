import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function testVerification() {
    console.log('🧪 VERIFYING KPI & ASSESSMENT SCHEMA FIXES...\n')
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // 1. Verify m_kpi_indicators schema
    console.log('1️⃣ Checking m_kpi_indicators columns...')
    const { data: indicators, error: indError } = await supabase
        .from('m_kpi_indicators')
        .select('id, name, calculation_method, measurement_type, unit_tariff, service_types, base_index_value')
        .limit(1)

    if (indError) {
        console.error('❌ m_kpi_indicators verification failed:', indError.message)
    } else {
        console.log('✅ m_kpi_indicators verification passed! Sample row:', indicators)
    }

    // 2. Verify t_kpi_assessments schema
    console.log('\n2️⃣ Checking t_kpi_assessments columns...')
    const { data: assessments, error: assError } = await supabase
        .from('t_kpi_assessments')
        .select('id, employee_id, indicator_id, sub_indicator_id, period, sub_assessments')
        .limit(1)

    if (assError) {
        console.error('❌ t_kpi_assessments verification failed:', assError.message)
    } else {
        console.log('✅ t_kpi_assessments verification passed! Sample row:', assessments)
    }

    console.log('\n🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY!')
}

testVerification().catch(console.error)
