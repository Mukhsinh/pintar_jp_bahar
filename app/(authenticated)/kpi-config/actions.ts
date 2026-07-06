'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getUnitsForKPI() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) return { data: [], error: 'Tidak terautentikasi' }

        const isSuperAdmin =
            user.app_metadata?.role === 'superadmin' ||
            user.user_metadata?.role === 'superadmin' ||
            user.email === 'admin@sungaibahar.com'

        const fetchClient = isSuperAdmin ? await createAdminClient() : supabase

        const { data, error } = await fetchClient
            .from('m_units')
            .select('id, code, name')
            .eq('is_active', true)
            .neq('code', 'ADMIN')
            .neq('name', 'SUPERADMIN')
            .order('code')

        if (error) throw error

        let filteredUnits = data || []
        if (!isSuperAdmin && user.user_metadata?.role === 'unit_manager' && user.user_metadata.unit_id) {
            filteredUnits = filteredUnits.filter(u => u.id === user.user_metadata.unit_id)
        }

        return { data: filteredUnits }
    } catch (error: any) {
        console.error('getUnitsForKPI error:', error)
        return { data: [], error: error.message }
    }
}

export async function getKPIStructure(unitId: string) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) return { error: 'Tidak terautentikasi' }

        const isSuperAdmin =
            user.app_metadata?.role === 'superadmin' ||
            user.user_metadata?.role === 'superadmin' ||
            user.email === 'admin@sungaibahar.com'

        const fetchClient = isSuperAdmin ? await createAdminClient() : supabase

        const [categoriesResult, indicatorsResult, subIndicatorsResult] = await Promise.all([
            fetchClient
                .from('m_kpi_categories')
                .select('*')
                .eq('unit_id', unitId)
                .order('category'),

            fetchClient
                .from('m_kpi_indicators')
                .select(`
          *,
          m_kpi_categories!m_kpi_indicators_category_id_fkey!inner (unit_id, configuration_style, is_weighted)
        `)
                .eq('m_kpi_categories.unit_id', unitId)
                .order('code'),

            fetchClient
                .from('m_kpi_sub_indicators')
                .select(`
          *,
          m_kpi_indicators!m_kpi_sub_indicators_indicator_id_fkey!inner (
            category_id,
            m_kpi_categories!m_kpi_indicators_category_id_fkey!inner (unit_id)
          )
        `)
                .eq('m_kpi_indicators.m_kpi_categories.unit_id', unitId)
                .order('code')
        ])

        if (categoriesResult.error) throw categoriesResult.error
        if (indicatorsResult.error) throw indicatorsResult.error
        if (subIndicatorsResult.error) throw subIndicatorsResult.error

        return {
            categories: categoriesResult.data || [],
            indicators: indicatorsResult.data || [],
            subIndicators: subIndicatorsResult.data || []
        }
    } catch (error: any) {
        console.error('getKPIStructure error:', error)
        return { error: error.message }
    }
}
