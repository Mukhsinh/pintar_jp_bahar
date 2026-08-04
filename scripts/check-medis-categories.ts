import { createAdminClient } from '../lib/supabase/server';

async function checkMedisCategories() {
    const supabase = await createAdminClient();

    const { data: categories } = await supabase
        .from('m_kpi_categories')
        .select('*');

    console.log('All Categories in DB:', categories);

    const { data: indicators } = await supabase
        .from('m_kpi_indicators')
        .select('id, name, calculation_method, category_id, m_kpi_categories(id, category, category_name)')
        .in('name', ['RAWAT INAP', 'Rawat Jalan', 'Tindakan']);

    console.log('Sample Indicators and their Joined Categories:', JSON.stringify(indicators, null, 2));
}

checkMedisCategories();
