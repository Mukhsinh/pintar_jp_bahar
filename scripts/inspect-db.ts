import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function main() {
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    console.log('Querying RPCs list via rest/v1 api...')
    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/`, {
            headers: {
                'apikey': serviceRoleKey,
                'Authorization': `Bearer ${serviceRoleKey}`
            }
        })
        const spec = await res.json()
        console.log('Available paths:', Object.keys(spec.paths).filter(p => p.startsWith('/rpc/')))
    } catch (err: any) {
        console.error('Fetch failed:', err.message)
    }
}

main()
