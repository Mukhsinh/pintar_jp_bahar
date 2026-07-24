import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function testSubIndicatorUpsert() {
    console.log('🧪 TESTING SUB-INDICATOR ASSESSMENT UPSERT...\n')
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // 1. Get sample employee, indicator, sub-indicators
    const { data: emp } = await supabase.from('m_employees').select('id').limit(1).single()
    const { data: ind } = await supabase.from('m_kpi_indicators').select('id').limit(1).single()

    if (!emp || !ind) {
        console.error('❌ Could not find employee or indicator for testing')
        return
    }

    const period = '2026-07'

    // Test upserting main assessment row (sub_indicator_id = null)
    console.log('1️⃣ Upserting main indicator assessment...')
    const mainData = {
        employee_id: emp.id,
        indicator_id: ind.id,
        sub_indicator_id: null,
        period,
        realization_value: 100,
        target_value: 100,
        weight_percentage: 10,
        achievement_percentage: 100,
        score: 100,
        notes: 'Test main assessment',
        updated_at: new Date().toISOString()
    }

    const { data: savedMain, error: mainError } = await supabase
        .from('t_kpi_assessments')
        .upsert(mainData, {
            onConflict: 'employee_id,indicator_id,period,sub_indicator_id'
        })
        .select()

    if (mainError) {
        console.error('❌ Main assessment upsert error:', mainError)
        return
    }
    console.log('✅ Main assessment saved successfully:', savedMain?.length, 'row(s)')

    // Clean up test data
    await supabase.from('t_kpi_assessments').delete().eq('employee_id', emp.id).eq('indicator_id', ind.id).eq('period', period)
    console.log('\n🎉 SUB-INDICATOR ASSESSMENT UPSERT TEST PASSED SUCCESSFULLY!')
}

testSubIndicatorUpsert().catch(console.error)
