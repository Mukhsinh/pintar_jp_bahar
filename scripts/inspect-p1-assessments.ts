import { createAdminClient } from '../lib/supabase/server';

async function inspectP1() {
    const supabase = await createAdminClient();

    const { data: doctors } = await supabase
        .from('m_employees')
        .select('id, full_name, employee_code, unit_id, m_units(name)')
        .ilike('full_name', '%annissa%');

    console.log('Doctor Annissa:', doctors);

    if (!doctors || doctors.length === 0) return;
    const docId = doctors[0].id;

    const { data: ass } = await supabase
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
          category_name,
          weight_percentage,
          configuration_style,
          is_weighted
        )
      )
    `)
        .eq('employee_id', docId);

    console.log('All assessments for dr. Annissa:', JSON.stringify(ass, null, 2));

    // Also check sub-assessments
    const { data: subAss } = await supabase
        .from('t_kpi_assessments')
        .select(`
      *,
      m_kpi_sub_indicators (
        id,
        name,
        base_index_value,
        unit_tariff
      ),
      m_kpi_indicators (
        id,
        name,
        m_kpi_categories (
          category
        )
      )
    `)
        .eq('employee_id', docId)
        .not('sub_indicator_id', 'is', null);

    console.log('Sub assessments for dr. Annissa:', JSON.stringify(subAss, null, 2));
}

inspectP1();
