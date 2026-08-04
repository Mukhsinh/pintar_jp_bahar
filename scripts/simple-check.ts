import { createAdminClient } from '../lib/supabase/server';

async function simpleCheck() {
    const supabase = await createAdminClient();
    const { data, error } = await supabase.from('t_kpi_assessments').select('*').limit(5);
    console.log('Error:', error);
    console.log('Data:', data);
}

simpleCheck();
