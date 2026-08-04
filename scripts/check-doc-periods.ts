import { createAdminClient } from '../lib/supabase/server';

async function checkDocPeriods() {
    const supabase = await createAdminClient();

    const { data: emp } = await supabase
        .from('m_employees')
        .select('id, full_name')
        .ilike('full_name', '%azwita%')
        .single();

    if (!emp) return;

    const { data: periods } = await supabase
        .from('t_kpi_assessments')
        .select('period, indicator_id, realization_value, score, m_kpi_indicators(name, calculation_method, m_kpi_categories(category))')
        .eq('employee_id', emp.id);

    console.log(`Assessments periods for ${emp.full_name}:`, periods);
}

checkDocPeriods();
