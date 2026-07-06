/**
 * Setup Authentication - Create Superadmin User
 * 
 * Script ini membuat user di Supabase Auth dan menambahkan record di m_employees
 * 
 * Usage:
 * 1. Pastikan .env.local sudah dikonfigurasi dengan benar
 * 2. Jalankan: npx tsx scripts/setup-auth.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY harus diset di .env.local')
  process.exit(1)
}

// Create Supabase client with service role key (bypass RLS)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function setupSuperadmin() {
  console.log('🚀 Memulai setup superadmin...\n')

  const email = 'admin@sungaibahar.com'
  const password = 'admin123'
  const fullName = 'Admin Sungai Bahar'
  const employeeCode = 'SA001'

  try {
    // 1. Create user in Supabase Auth
    console.log('📝 Membuat user di Supabase Auth...')
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name: fullName
      }
    })

    if (authError) {
      if (authError.message.includes('already registered')) {
        console.log('ℹ️  User sudah ada di Auth, melanjutkan ke database...')
      } else {
        throw authError
      }
    } else {
      console.log('✅ User berhasil dibuat di Auth')
      console.log(`   User ID: ${authData.user.id}`)
    }

    // 2. Ensure IT unit exists
    console.log('\n📝 Memastikan unit IT ada...')
    const { error: unitError } = await supabase
      .from('m_units')
      .upsert({
        code: 'IT',
        name: 'Information Technology',
        proportion_percentage: 25.00,
        is_active: true
      }, {
        onConflict: 'code'
      })

    if (unitError) throw unitError
    console.log('✅ Unit IT siap')

    // 3. Get unit ID
    const { data: unitData, error: unitFetchError } = await supabase
      .from('m_units')
      .select('id')
      .eq('code', 'IT')
      .single()

    if (unitFetchError) throw unitFetchError

    // 4. Create or update employee record
    console.log('\n📝 Membuat/update record employee...')
    const { error: employeeError } = await supabase
      .from('m_employees')
      .upsert({
        employee_code: employeeCode,
        full_name: fullName,
        unit_id: unitData.id,
        role: 'superadmin',
        email: email,
        tax_status: 'TK/0',
        is_active: true
      }, {
        onConflict: 'email'
      })

    if (employeeError) throw employeeError
    console.log('✅ Employee record berhasil dibuat/diupdate')

    // 5. Verify setup
    console.log('\n🔍 Verifikasi setup...')
    const { data: verifyData, error: verifyError } = await supabase
      .from('m_employees')
      .select('employee_code, full_name, email, role, is_active, m_units(name)')
      .eq('email', email)
      .single()

    if (verifyError) throw verifyError

    console.log('\n✅ Setup berhasil!')
    console.log('\n📋 Detail Superadmin:')
    console.log('   Employee Code:', verifyData.employee_code)
    console.log('   Nama:', verifyData.full_name)
    console.log('   Email:', verifyData.email)
    console.log('   Role:', verifyData.role)
    console.log('   Unit:', Array.isArray(verifyData.m_units) && verifyData.m_units.length > 0 ? verifyData.m_units[0].name : 'N/A')
    console.log('   Status:', verifyData.is_active ? 'Active' : 'Inactive')
    console.log('\n🔐 Kredensial Login:')
    console.log('   Email:', email)
    console.log('   Password:', password)
    console.log('\n🌐 Silakan login di: http://localhost:3000/login')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  }
}

// Run setup
setupSuperadmin()
