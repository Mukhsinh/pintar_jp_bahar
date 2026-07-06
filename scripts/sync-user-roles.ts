import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
})

async function syncUserRoles() {
    console.log('🔄 Syncing user roles from m_employees to auth.users.user_metadata...\n')

    try {
        // 1. Fetch all employees
        const { data: employees, error: empError } = await supabase
            .from('m_employees')
            .select('user_id, role, full_name')

        if (empError) {
            console.error('❌ Error fetching employees:', empError)
            return
        }

        console.log(`Found ${employees?.length || 0} employees.`)

        // 2. Fetch all auth users to merge/verify
        const { data: authData, error: authError } = await supabase.auth.admin.listUsers()
        if (authError) {
            console.error('❌ Error listing auth users:', authError)
            return
        }

        const authUsersMap = new Map(authData.users.map(u => [u.id, u]))

        for (const emp of employees || []) {
            if (!emp.user_id) {
                console.log(`⚠️  Employee "${emp.full_name}" has no user_id, skipping.`)
                continue
            }

            const authUser = authUsersMap.get(emp.user_id)
            if (!authUser) {
                console.log(`⚠️  No auth user found for employee "${emp.full_name}" (ID: ${emp.user_id}), skipping.`)
                continue
            }

            const currentRole = authUser.user_metadata?.role
            const targetRole = emp.role

            if (currentRole === targetRole) {
                console.log(`✅ User ${authUser.email} already has correct role: ${targetRole}`)
                continue
            }

            console.log(`🔄 Updating ${authUser.email}: ${currentRole || 'not set'} -> ${targetRole}`)
            const updatedMetadata = {
                ...authUser.user_metadata,
                role: targetRole
            }

            const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(
                emp.user_id,
                { user_metadata: updatedMetadata }
            )

            if (updateError) {
                console.error(`❌ Failed to update ${authUser.email}:`, updateError.message)
            } else {
                console.log(`   └─ ✅ Successfully updated role to: ${targetRole}`)
            }
        }

        console.log('\n🎉 Sync completed!')

    } catch (error) {
        console.error('❌ Sync failed:', error)
    }
}

syncUserRoles()
