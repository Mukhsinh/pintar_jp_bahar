import { createAdminClient } from '../lib/supabase/server';

async function inspectMedis() {
    const supabase = await createAdminClient();

    // 1. Get MEDIS unit ID
    const { data: medisUnit } = await supabase
        .from('m_units')
        .select('*')
        .ilike('name', '%medis%');

    console.log('MEDIS Unit:', medisUnit);

    if (!medisUnit || medisUnit.length === 0) return;
    const unitId = medisUnit[0].id;

    // 2. Get doctors in MEDIS unit
    const { data: doctors } = await supabase
        .from('m_employees')
        .select('id, full_name, employee_code, unit_id')
        .eq('unit_id', unitId)
        .limit(5);

    console.log('Sample Doctors:', doctors);

    if (!doctors || doctors.length === 0) return;
    const docId = doctors[0].id;

    // 3. Get assessments for this doctor
    const { data: docAssessments } = await supabase
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
        .eq('employee_id', docId);

    console.log(`Assessments for ${doctors[0].full_name}:`, JSON.stringify(docAssessments, null, 2));

    // 4. Also get all KPI indicators assigned to MEDIS unit or categories
    const { data: allCategories } = await supabase.from('m_kpi_categories').select('*');
    console.log('All KPI Categories:', allCategories);
}

inspectMedis();
