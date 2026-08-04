import { createAdminClient } from '../lib/supabase/server';

async function checkMedisCategory() {
    const supabase = await createAdminClient();

    const { data: cat } = await supabase
        .from('m_kpi_categories')
        .select('*')
        .eq('id', '80b85abf-9c9d-43a0-b714-5860a1122dbf')
        .single();

    console.log('MEDIS P2 Category detail:', cat);
}

checkMedisCategory();
