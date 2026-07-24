import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function main() {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    })

    console.log('🚀 Running schema repair for KPI indicators and Assessments...\n')

    const migrationSql = `
    -- 1. Fix m_kpi_indicators table
    ALTER TABLE m_kpi_indicators 
    ADD COLUMN IF NOT EXISTS calculation_method VARCHAR(20) DEFAULT 'indexing',
    ADD COLUMN IF NOT EXISTS measurement_type VARCHAR(20) DEFAULT 'scoring',
    ADD COLUMN IF NOT EXISTS unit_tariff DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS service_types TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS base_index_value DECIMAL(15,2) DEFAULT 0;

    -- 2. Fix m_kpi_sub_indicators table
    ALTER TABLE m_kpi_sub_indicators 
    ADD COLUMN IF NOT EXISTS measurement_type VARCHAR(20) DEFAULT 'scoring',
    ADD COLUMN IF NOT EXISTS unit_tariff DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS base_index_value DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS service_types TEXT[] DEFAULT '{}';

    -- 3. Fix t_kpi_assessments table
    ALTER TABLE t_kpi_assessments 
    ADD COLUMN IF NOT EXISTS sub_indicator_id UUID REFERENCES m_kpi_sub_indicators(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS sub_assessments JSONB DEFAULT '[]'::jsonb;

    -- 4. Recreate unique index for upsert on t_kpi_assessments
    DROP INDEX IF EXISTS t_kpi_assessments_multi_unique_idx;
    DROP INDEX IF EXISTS t_kpi_assessments_upsert_key;

    DO $$
    BEGIN
        -- Try Postgres 15+ NULLS NOT DISTINCT index first
        BEGIN
            CREATE UNIQUE INDEX t_kpi_assessments_multi_unique_idx 
            ON t_kpi_assessments (employee_id, indicator_id, period, sub_indicator_id) 
            NULLS NOT DISTINCT;
        EXCEPTION WHEN OTHERS THEN
            -- Fallback for older Postgres
            CREATE UNIQUE INDEX t_kpi_assessments_multi_unique_idx 
            ON t_kpi_assessments (employee_id, indicator_id, period, COALESCE(sub_indicator_id, '00000000-0000-0000-0000-000000000000'::uuid));
        END;
    END $$;

    -- Reload PostgREST schema cache
    NOTIFY pgrst, 'reload schema';
  `

    const { data, error } = await supabase.rpc('exec_sql', { sql: migrationSql })

    if (error) {
        console.error('❌ exec_sql error:', error)
    } else {
        console.log('✅ Schema migration executed successfully!')
    }
}

main().catch(console.error)
