import { createAdminClient } from '../lib/supabase/server';

async function checkPeriods() {
    const supabase = await createAdminClient();
    const { data: pools } = await supabase.from('t_pool').select('period, net_pool');
    console.log('Existing pools:', pools);

    const { data: assessments } = await supabase.from('t_kpi_assessments').select('period').limit(10);
    console.log('Sample assessments periods:', assessments);
}

checkPeriods();
