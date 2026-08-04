import { createAdminClient } from '../lib/supabase/server';

async function checkEmpP1() {
    const supabase = await createAdminClient();

    const { data: emp } = await supabase
        .from('m_employees')
        .select('id, full_name, m_units(name)')
        .eq('id', '0a1786a0-3d3b-4569-ab95-7341f24ce820')
        .single();

    console.log('Employee:', emp);

    const { data: ind } = await supabase
        .from('m_kpi_indicators')
        .select('id, name, category_id, m_kpi_categories(id, category, category_name)')
        .eq('id', 'efbc69ae-e118-4297-82a5-72297a3f09c8')
        .single();

    console.log('Indicator & Category:', ind);
}

checkEmpP1();
