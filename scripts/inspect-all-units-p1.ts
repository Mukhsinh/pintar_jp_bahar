import { createAdminClient } from '../lib/supabase/server';

async function inspectAllUnitsP1() {
    const supabase = await createAdminClient();

    // Get sample assessments from P1 category indicators
    const { data: p1Assessments } = await supabase
        .from('t_kpi_assessments')
        .select(`
      *,
      m_employees (full_name, employee_code, m_units(name)),
      m_kpi_indicators!inner (
        id,
        name,
        category_id,
        m_kpi_categories!inner (
          id,
          category,
          category_name,
          weight_percentage
        )
      )
    `)
        .limit(20);

    console.log('Sample P1 & Category Assessments:', JSON.stringify(p1Assessments, null, 2));
}

inspectAllUnitsP1();
