import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const projectRef = 'dccruqyyzhainolwjgop'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN_KEY

async function runSql(sqlQuery: string) {
    console.log('Sending SQL to Supabase Management API...')

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
        return null
    }

    const result = await response.json()
    return result
}

async function main() {
    // 1. Inspect current column types
    const inspectSql = `
        SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_name IN ('m_kpi_indicators', 'm_kpi_sub_indicators', 't_kpi_assessments', 't_realization')
          AND column_name IN ('base_index_value', 'unit_tariff', 'basic_index_value', 'target_value', 'realization_value', 'score');
    `
    const currentColumns = await runSql(inspectSql)
    console.log('Current Column Definitions:', JSON.stringify(currentColumns, null, 2))

    // 2. Alter column types to NUMERIC(15,4)
    const alterSql = `
        -- m_kpi_indicators
        ALTER TABLE m_kpi_indicators 
            ALTER COLUMN base_index_value TYPE NUMERIC(15,4),
            ALTER COLUMN unit_tariff TYPE NUMERIC(15,4),
            ALTER COLUMN target_value TYPE NUMERIC(15,4);

        -- m_kpi_sub_indicators
        ALTER TABLE m_kpi_sub_indicators 
            ALTER COLUMN base_index_value TYPE NUMERIC(15,4),
            ALTER COLUMN unit_tariff TYPE NUMERIC(15,4),
            ALTER COLUMN target_value TYPE NUMERIC(15,4);

        -- t_kpi_assessments (if exists)
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 't_kpi_assessments') THEN
                ALTER TABLE t_kpi_assessments 
                    ALTER COLUMN realization_value TYPE NUMERIC(15,4),
                    ALTER COLUMN score TYPE NUMERIC(15,4),
                    ALTER COLUMN target_value TYPE NUMERIC(15,4);
            END IF;
        END $$;

        -- t_realization (if exists)
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 't_realization') THEN
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 't_realization' AND column_name = 'realization_value') THEN
                    ALTER TABLE t_realization ALTER COLUMN realization_value TYPE NUMERIC(15,4);
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 't_realization' AND column_name = 'score') THEN
                    ALTER TABLE t_realization ALTER COLUMN score TYPE NUMERIC(15,4);
                END IF;
            END IF;
        END $$;

        NOTIFY pgrst, 'reload schema';
    `

    console.log('\nExecuting schema alterations...')
    const alterResult = await runSql(alterSql)
    console.log('Alter Result:', alterResult)

    // 3. Verify updated column types
    const verifyColumns = await runSql(inspectSql)
    console.log('\nVerified Column Definitions:', JSON.stringify(verifyColumns, null, 2))
}

main().catch(console.error)
