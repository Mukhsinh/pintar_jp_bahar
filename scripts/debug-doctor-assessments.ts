import { createAdminClient } from '../lib/supabase/server';

async function debugDoctor() {
    const supabase = await createAdminClient();

    const { data: emp } = await supabase
        .from('m_employees')
        .select('id, full_name, unit_id, m_units(*)')
        .ilike('full_name', '%azwita%')
        .single();

    console.log('Doctor:', emp);
    if (!emp) return;

    const { data: assessments } = await supabase
        .from('t_kpi_assessments')
        .select(`
      *,
      m_kpi_indicators (
        id,
        name,
        weight_percentage,
        base_index_value,
        target_value,
        calculation_method,
        category_id,
        m_kpi_categories (
          id,
          name,
          category,
          weight_percentage,
          configuration_style,
          is_weighted
        )
      )
    `)
        .eq('employee_id', emp.id)
        .eq('period', '2026-07');

    console.log('Assessments for 2026-07:', JSON.stringify(assessments, null, 2));
}

debugDoctor();
