import { createAdminClient } from '../lib/supabase/server';

async function checkDirect() {
    const supabase = await createAdminClient();

    const { data: ass } = await supabase
        .from('t_kpi_assessments')
        .select(`
      id,
      employee_id,
      indicator_id,
      score,
      realization_value,
      period,
      m_employees (full_name, m_units(name)),
      m_kpi_indicators (
        name,
        category_id,
        m_kpi_categories (
          category,
          category_name
        )
      )
    `)
        .limit(25);

    console.log('Direct assessments:', JSON.stringify(ass, null, 2));
}

checkDirect();
