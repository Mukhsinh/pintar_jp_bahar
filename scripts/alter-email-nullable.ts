import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function main() {
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const sql = 'ALTER TABLE m_employees ALTER COLUMN email DROP NOT NULL;'

    console.log('Running SQL via exec...')
    const { data: d1, error: e1 } = await supabase.rpc('exec', { sql })
    if (e1) {
        console.error('exec failed:', e1.message)

        console.log('Running SQL via exec_sql...')
        const { data: d2, error: e2 } = await supabase.rpc('exec_sql', { sql })
        if (e2) {
            console.error('exec_sql failed:', e2.message)
        } else {
            console.log('exec_sql succeeded:', d2)
        }
    } else {
        console.log('exec succeeded:', d1)
    }
}

main()
