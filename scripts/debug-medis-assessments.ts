import { createAdminClient } from '../lib/supabase/server';

async function main() {
    const supabase = await createAdminClient();

    const { data: medisUnit } = await supabase
        .from('m_units')
        .select('*')
        .ilike('name', '%medis%');

    console.log('MEDIS Unit:', medisUnit);
    if (!medisUnit || medisUnit.length === 0) return;
    const unitId = medisUnit[0].id;

    const { data: categories } = await supabase
        .from('m_kpi_categories')
        .select('*')
        .eq('unit_id', unitId);
    console.log('MEDIS Categories:', categories);

    const { data: indicators } = await supabase
        .from('m_kpi_indicators')
        .select('*, m_kpi_categories(*)')
        .in('category_id', categories.map(c => c.id));
    console.log('MEDIS Indicators:', indicators);

    const { data: doctors } = await supabase
        .from('m_employees')
        .select('*')
        .eq('unit_id', unitId);
    console.log(`Found ${doctors?.length} doctors in MEDIS unit.`);

    if (doctors && doctors.length > 0) {
        for (const d of doctors.slice(0, 3)) {
            const { data: ass } = await supabase
                .from('t_kpi_assessments')
                .select('*, m_kpi_indicators(*, m_kpi_categories(*))')
                .eq('employee_id', d.id);
            console.log(`\nAssessments for ${d.full_name} (${d.employee_code}):`, ass.map(a => ({
                indicator: a.m_kpi_indicators?.name,
                category: a.m_kpi_indicators?.m_kpi_categories?.category,
                calc_method: a.m_kpi_indicators?.calculation_method,
                score: a.score,
                realization: a.realization_value,
                period: a.period
            })));
        }
    }
}

main();
