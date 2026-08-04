import { createAdminClient } from '../lib/supabase/server';
import { generateIncentiveReport } from '../app/api/reports/generate/route';

async function checkEny() {
    const supabase = await createAdminClient();
    const report = await generateIncentiveReport(supabase, '2026-07');
    const eny = report.find(r => r.employee_name.includes('ENY'));
    console.log('Eny Nurhayati Report Row:', eny);
}

checkEny();
