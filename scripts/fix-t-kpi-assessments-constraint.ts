import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const projectRef = 'dccruqyyzhainolwjgop'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN_KEY

async function runSql(sqlQuery: string) {
    console.log('Sending SQL to drop old constraint and fix uniqueness...')

    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sqlQuery })
    })

    if (!response.ok) {
        const errorText = await response.text()
        console.error(`❌ HTTP ${response.status}: ${errorText}`)
        return false
    }

    const result = await response.json()
    console.log('✅ SQL executed successfully:', result)
    return true
}

async function main() {
    const sql = `
    -- 1. Remove duplicate records if any exist
    DELETE FROM t_kpi_assessments a
    WHERE a.id IN (
        SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY employee_id, indicator_id, period, COALESCE(sub_indicator_id, '00000000-0000-0000-0000-000000000000'::uuid)
                       ORDER BY updated_at DESC, created_at DESC
                   ) as rn
            FROM t_kpi_assessments
        ) t
        WHERE t.rn > 1
    );

    -- 2. Drop the old strict 3-column unique constraint
    ALTER TABLE t_kpi_assessments 
    DROP CONSTRAINT IF EXISTS t_kpi_assessments_employee_id_indicator_id_period_key;

    -- 3. Drop old indexes if exist
    DROP INDEX IF EXISTS t_kpi_assessments_multi_unique_idx;
    DROP INDEX IF EXISTS t_kpi_assessments_upsert_key;

    -- 4. Create robust multi-column unique index with NULLS NOT DISTINCT (supported in PG 15+)
    DO $$
    BEGIN
        BEGIN
            CREATE UNIQUE INDEX t_kpi_assessments_multi_unique_idx 
            ON t_kpi_assessments (employee_id, indicator_id, period, sub_indicator_id) 
            NULLS NOT DISTINCT;
        EXCEPTION WHEN OTHERS THEN
            CREATE UNIQUE INDEX t_kpi_assessments_multi_unique_idx 
            ON t_kpi_assessments (employee_id, indicator_id, period, COALESCE(sub_indicator_id, '00000000-0000-0000-0000-000000000000'::uuid));
        END;
    END $$;

    -- 5. Refresh PostgREST schema cache
    NOTIFY pgrst, 'reload schema';
  `

    await runSql(sql)
}

main().catch(console.error)
