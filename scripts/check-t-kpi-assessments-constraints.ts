import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const projectRef = 'dccruqyyzhainolwjgop'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN_KEY

async function runSql(sqlQuery: string) {
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

    return await response.json()
}

async function main() {
    const sql = `
    SELECT conname, pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE conrelid = 't_kpi_assessments'::regclass;
  `
    const result = await runSql(sql)
    console.log('Constraints on t_kpi_assessments:', JSON.stringify(result, null, 2))
}

main().catch(console.error)
