import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const projectRef = 'dccruqyyzhainolwjgop'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN_KEY

async function runSql(sqlQuery: string) {
    console.log('Sending SQL to Supabase Management API for project:', projectRef)

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
    console.log('✅ Query executed successfully:', result)
    return true
}

async function main() {
    const sql = `
    -- 1. Add missing columns to m_kpi_indicators
    ALTER TABLE m_kpi_indicators 
    ADD COLUMN IF NOT EXISTS calculation_method VARCHAR(20) DEFAULT 'indexing',
    ADD COLUMN IF NOT EXISTS measurement_type VARCHAR(20) DEFAULT 'scoring',
    ADD COLUMN IF NOT EXISTS unit_tariff DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS service_types TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS base_index_value DECIMAL(15,2) DEFAULT 0;

    -- 2. Add missing columns to m_kpi_sub_indicators
    ALTER TABLE m_kpi_sub_indicators 
    ADD COLUMN IF NOT EXISTS measurement_type VARCHAR(20) DEFAULT 'scoring',
    ADD COLUMN IF NOT EXISTS unit_tariff DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS base_index_value DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS service_types TEXT[] DEFAULT '{}';

    -- 3. Add missing columns to t_kpi_assessments
    ALTER TABLE t_kpi_assessments 
    ADD COLUMN IF NOT EXISTS sub_indicator_id UUID REFERENCES m_kpi_sub_indicators(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS sub_assessments JSONB DEFAULT '[]'::jsonb;

    -- 4. Recreate unique index for upsert on t_kpi_assessments
    DROP INDEX IF EXISTS t_kpi_assessments_multi_unique_idx;
    DROP INDEX IF EXISTS t_kpi_assessments_upsert_key;

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

    NOTIFY pgrst, 'reload schema';
  `

    await runSql(sql)
}

main().catch(console.error)
