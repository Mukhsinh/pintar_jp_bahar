import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function checkSchema() {
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    console.log('Testing m_kpi_indicators with measurement_type...')
    const { data: indData, error: indError } = await supabase
        .from('m_kpi_indicators')
        .select('id, name, measurement_type')
        .limit(1)

    console.log('m_kpi_indicators result:', { data: indData, error: indError })

    console.log('\nTesting t_kpi_assessments with sub_indicator_id...')
    const { data: assData, error: assError } = await supabase
        .from('t_kpi_assessments')
        .select('id, employee_id, sub_indicator_id')
        .limit(1)

    console.log('t_kpi_assessments result:', { data: assData, error: assError })
}

checkSchema().catch(console.error)
