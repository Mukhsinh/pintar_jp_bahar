import { createAdminClient } from '../lib/supabase/server';
import { generateIncentiveReport } from '../app/api/reports/generate/route';

async function testReport() {
    try {
        const supabase = await createAdminClient();
        // Test period
        const period = '2026-07';
        console.log(`Generating incentive report for period ${period}...`);
        const report = await generateIncentiveReport(supabase, period);
        console.log(`Generated ${report.length} report rows.`);
        if (report.length > 0) {
            console.log('Sample Row 1:', {
                name: report[0].employee_name,
                unit: report[0].unit,
                p1_indeks: report[0].p1_score,
                p2_indeks: report[0].p2_score,
                p3_indeks: report[0].p3_score,
                total_score_indeks: report[0].total_score,
                p1_prio: report[0].p1_priority,
                p2_prio: report[0].p2_priority,
                p3_prio: report[0].p3_priority,
                total_priority: report[0].total_priority_score,
                pir: report[0].pir_value,
                gross: report[0].gross_incentive,
                net: report[0].net_incentive
            });
            const priorityRows = report.filter(r => (r.total_priority_score > 0 || r.p1_priority > 0 || r.p2_priority > 0 || r.p3_priority > 0));
            console.log(`Found ${priorityRows.length} rows with priority scores:`, priorityRows.map(r => ({
                name: r.employee_name,
                total_indeks: r.total_score,
                pir: r.pir_value,
                index_incentive: r.total_score * r.pir_value,
                insentif_prioritas: r.total_priority_score,
                gross: r.gross_incentive
            })));
        }
    } catch (err) {
        console.error('Error generating report:', err);
    }
}

testReport();
