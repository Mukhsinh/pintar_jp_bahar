import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { isMedicalUnit } from '@/lib/utils/medical-unit'
import * as fs from 'fs'

const OMIT_KEYS = ['created_at', 'updated_at', 'created_by', 'updated_by']

/**
 * Batched .in() helper to avoid Supabase PostgREST URL length overflow.
 * Splits large arrays into chunks, queries each batch, and merges results.
 */
async function batchedIn(
  supabase: any,
  table: string,
  selectFields: string,
  filterColumn: string,
  filterValues: string[],
  additionalFilters?: (q: any) => any,
  batchSize: number = 20 // Reduced from 50 to stay under 1000 rows with 30+ indicators/emp in Keperawatan unit
): Promise<any[]> {
  if (filterValues.length === 0) return []

  const results: any[] = []
  for (let i = 0; i < filterValues.length; i += batchSize) {
    const batch = filterValues.slice(i, i + batchSize)
    let query = supabase.from(table).select(selectFields).in(filterColumn, batch)
    if (additionalFilters) query = additionalFilters(query)
    // Important: even with 50 emps, if indicators are many, we might hit 1000.
    // Fetch up to 10000 rows per batch just in case, though PostgREST might still cap at 1000.
    const { data, error } = await query.range(0, 10000)
    if (error) {
      console.error(`[batchedIn] Error fetching batch ${i / batchSize + 1} from ${table}:`, error)
      throw error
    }
    if (data) results.push(...data)

    if (data && data.length >= 1000 && batchSize > 10) {
      console.warn(`[batchedIn] Warning: Batch potentially truncated (${data.length} rows returned). Consider reducing batchSize further.`)
    }
  }
  console.log(`[batchedIn] ${table}.${filterColumn}: ${filterValues.length} IDs -> ${Math.ceil(filterValues.length / batchSize)} batches -> ${results.length} rows`)
  return results
}

import { getTERCategory, getTERRate } from '@/lib/formulas/ter-lookup'

function calculatePPh21(
  monthlyGross: number,
  employeeStatus?: string,
  taxType?: string,
  taxStatus: string = 'TK/0',
  pnsGrade?: string | number,
  mechanism: 'none' | 'ter' | 'final_pp80' = 'ter'
): { amount: number, text: string } {
  if (monthlyGross <= 0) return { amount: 0, text: 'Rp 0' }

  // 1. Tanpa Potongan Pajak
  if (mechanism === 'none') return { amount: 0, text: 'Tanpa Potongan (0%)' }

  // 2. Mekanisme Final (PP 80/2010)
  if (mechanism === 'final_pp80') {
    // Only applies to ASN (PNS) or if a grade is explicitly provided
    // status can be in employeeStatus (legacy) or potentially passed via employmentStatus
    const stat = (employeeStatus || '').toUpperCase()
    const gradeStr = String(pnsGrade || '').trim().toUpperCase()
    const hasGrade = gradeStr !== '' && gradeStr !== '-' && gradeStr !== 'NULL'

    // PPPK and BLUD are treated as Grade II or below (0% tax under PP 80/2010)
    if (stat === 'PPPK' || stat === 'BLUD') {
      return { amount: 0, text: `${stat} (Bukan PNS/ASN - 0%)` }
    }

    // Robust check: If status is 'ASN'/'PNS' OR it's 'ACTIVE' with a valid grade, treat as PNS
    if (stat !== 'ASN' && stat !== 'PNS' && stat !== 'ACTIVE' && stat !== 'PNS' && !hasGrade) {
      return { amount: 0, text: 'Bukan PNS/ASN (0%)' }
    }

    if (gradeStr.startsWith('IV') || gradeStr.startsWith('4')) {
      return { amount: Math.round(monthlyGross * 0.15), text: `15% x Bruto (PNS Golongan IV)` }
    }
    if (gradeStr.startsWith('III') || gradeStr.startsWith('3')) {
      return { amount: Math.round(monthlyGross * 0.05), text: `5% x Bruto (PNS Golongan III)` }
    }

    // Fallback detection if status is ASN/PNS but grade is undefined/null
    if (stat === 'ASN' || stat === 'PNS' || stat === 'ACTIVE') {
      return { amount: Math.round(monthlyGross * 0.05), text: `5% x Bruto (PNS - Gradeless fallback)` }
    }

    return { amount: 0, text: `Golongan II Kebawah / Lainnya (0%)` }
  }

  // 3. Mekanisme TER (PP 58/2023) - Default
  // Ensure that if 'ter' is globally chosen, it calculates TER for everyone based on PTKP
  // We do NOT exempt ASN Final here because setting ter globally overrides legacy Final tax rules.

  // Get TER Category based on PTKP status
  const category = getTERCategory(taxStatus)

  // Get TER Rate based on Category and monthly gross income
  const ratePercentage = getTERRate(category, monthlyGross)

  // Calculate Tax
  const taxAmount = (monthlyGross * ratePercentage) / 100

  return { amount: Math.round(taxAmount), text: `${ratePercentage}% x Bruto (TER Kategori ${category})` }
}

/**
 * Save PIR history for audit trail.
 * Upserts record per period+unit combination.
 */
async function savePIRHistory(
  supabase: any,
  period: string,
  unitId: string,
  unitName: string,
  netPoolAmount: number,
  proportionPercentage: number,
  allocatedForUnit: number,
  totalSkorKolektif: number,
  pirValue: number,
  employeeCount: number
) {
  try {
    const { error } = await supabase
      .from('t_history_pir')
      .upsert(
        {
          period,
          unit_id: unitId,
          unit_name: unitName,
          net_pool_amount: netPoolAmount,
          proportion_percentage: proportionPercentage,
          allocated_for_unit: allocatedForUnit,
          total_skor_kolektif: totalSkorKolektif,
          pir_value: pirValue,
          employee_count: employeeCount,
        },
        { onConflict: 'period,unit_id' }
      )
    if (error) console.error('Failed to save PIR history:', error.message)
  } catch (err: any) {
    console.error('PIR history save error:', err.message)
  }
}

/**
 * Generate reports based on type and period
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.7, 12.8
 */
export async function POST(request: NextRequest) {
  try {
    const { reportType, period, unitId: reqUnitId, employeeId, detailLevel } = await request.json()

    if (!reportType || !period) {
      return NextResponse.json(
        { error: 'Report type and period are required' },
        { status: 400 }
      )
    }

    const supabaseClient = await createClient()
    const { data: { user } } = await supabaseClient.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createAdminClient()

    // Get user employee info for RBAC
    let { data: employee } = await supabase
      .from('m_employees')
      .select('role, unit_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const authRole = user.app_metadata?.role || user.user_metadata?.role
    const isSuperAdmin = authRole === 'superadmin' || user.email === 'admin@sungaibahar.com'

    if (!employee) {
      if (isSuperAdmin) {
        employee = { role: 'superadmin', unit_id: '0' }
      } else {
        return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
      }
    }

    // Force role override if auth metadata says superadmin
    if (isSuperAdmin && employee) {
      employee.role = 'superadmin'
    }

    // Role-based restrictions
    let unitId = reqUnitId
    if (employee.role === 'unit_manager') {
      // Force unit manager to their own unit
      unitId = employee.unit_id
      if (reportType === 'unit-comparison') {
        return NextResponse.json({ error: 'Akses ditolak: Manajer unit tidak dapat mengakses laporan perbandingan unit.' }, { status: 403 })
      }
    }

    // 1. Prerequisite Check: Data Pool
    const { data: poolExists, error: poolCheckError } = await supabase
      .from('t_pool')
      .select('id')
      .eq('period', period)
      .maybeSingle()

    if (!poolExists) {
      return NextResponse.json({
        success: false,
        error: `Data Pool tidak ditemukan untuk periode ${period}. Laporan tidak dapat dibuat tanpa konfigurasi Pool.`
      }, { status: 400 })
    }

    // 2. Prerequisite Check: Data Penilaian (KPI)
    // We check if at least one assessment exists for this period
    let assessmentQuery = supabase
      .from('t_kpi_assessments')
      .select('id')
      .eq('period', period)
      .limit(1)

    if (unitId && unitId !== 'all') {
      // If a unit is specified, we check if there are assessments for employees in that unit
      const { data: unitEmps } = await supabase
        .from('m_employees')
        .select('id')
        .eq('unit_id', unitId)
        .range(0, 9999)

      const empIds = unitEmps?.map(e => e.id) || []
      if (empIds.length > 0) {
        // Use all employee IDs for prerequisite check to avoid missing data if the sample doesn't have assessments
        assessmentQuery = assessmentQuery.in('employee_id', empIds)
      } else {
        return NextResponse.json({
          success: false,
          error: `Tidak ada data karyawan di unit yang dipilih untuk periode ${period}.`
        }, { status: 400 })
      }
    }

    const { data: assessmentExists, error: assCheckError } = await assessmentQuery.maybeSingle()

    if (!assessmentExists) {
      return NextResponse.json({
        success: false,
        error: `Data Penilaian belum diisi untuk periode ${period}. Laporan tidak dapat digenerate jika data penilaian kosong.`
      }, { status: 400 })
    }

    let data: any[] = []

    switch (reportType) {
      case 'incentive':
        data = await generateIncentiveReport(supabase, period, unitId, employeeId)
        break
      case 'kpi-achievement':
        data = await generateKPIAchievementReport(supabase, period, unitId, employeeId, detailLevel)
        break
      case 'unit-comparison':
        data = await generateUnitComparisonReport(supabase, period, unitId)
        break
      case 'employee-slip':
        data = await generateEmployeeSlipReport(supabase, period, unitId, employeeId)
        break
      default:
        return NextResponse.json(
          { error: 'Invalid report type' },
          { status: 400 }
        )
    }

    // Check if data is empty (Requirement 12.7)
    // Build summary metadata for selected unit/period
    const effectiveUnitId = unitId && unitId !== 'all' ? unitId : null
    let totalEmployeesInUnit = 0
    let assessedCount = 0
    let notAssessedCount = 0
    let completionPercentage = 0

    try {
      // --- Summary Logic Sync ---
      let empListQuery = supabase
        .from('m_employees')
        .select('id, unit_id, role, is_active')
        .neq('role', 'superadmin')

      if (effectiveUnitId) {
        empListQuery = empListQuery.eq('unit_id', effectiveUnitId)
      }

      const { data: unitEmployees, error: unitEmpErr } = await empListQuery.range(0, 9999)
      if (unitEmpErr) console.error('[Summary] Error fetching employees:', unitEmpErr)

      const unitEmpIds = (unitEmployees || []).map(e => e.id)
      totalEmployeesInUnit = unitEmpIds.length
      console.log(`[Summary] Found ${totalEmployeesInUnit} candidate employees for unit ${effectiveUnitId}`)

      if (totalEmployeesInUnit > 0) {
        // Use batched query to handle large units without URL overflow
        try {
          const assessedEmps = await batchedIn(
            supabase,
            't_kpi_assessments',
            'employee_id',
            'employee_id',
            unitEmpIds,
            q => q.eq('period', period)
          )

          const uniqueAssessedIds = new Set((assessedEmps || []).map((a: any) => a.employee_id))
          assessedCount = uniqueAssessedIds.size
          console.log(`[Summary] Period ${period}: Found ${assessedCount} unique assessed employees out of ${totalEmployeesInUnit}`)
        } catch (assessErr) {
          console.error('[Summary] Error fetching assessments:', assessErr)
        }
      } else {
        assessedCount = 0
      }
      // ----------------------------------------

      notAssessedCount = totalEmployeesInUnit - assessedCount
      if (notAssessedCount < 0) notAssessedCount = 0
      completionPercentage = totalEmployeesInUnit > 0
        ? Math.round((assessedCount / totalEmployeesInUnit) * 100)
        : 0
      // Final check for empty results to provide clear feedback
      if (data.length === 0) {
        console.log(`[Report] No data generated for unit ${unitId}, period ${period}`)
        return NextResponse.json({
          success: true,
          data: [],
          summary: {
            period,
            unit_name: unitId || 'Semua Unit',
            total_employees: 0,
            total_assessed: 0,
            total_displayed: 0,
            completion_percentage: 0
          },
          message: `Tidak ada data penilaian yang ditemukan untuk unit ${unitId || 'terpilih'} pada periode ${period}.`
        })
      }

      // 3. Count unique employees in 'KEPERAWATAN' with assessments in '2026-05'
      // CRITICAL: Synchronize summary counts with the actual report data
      // The "Sudah Dinilai" and "Ditampilkan" counts must match the final data length
      const reportRows = data.length;

      const summary = {
        period,
        unit_name: data[0]?.unit || 'Semua Unit',
        total_employees: totalEmployeesInUnit,
        total_assessed: assessedCount, // Use the real count from database
        total_displayed: data.length,   // Use the actually generated report length
        completion_percentage: totalEmployeesInUnit > 0 ? Math.round((assessedCount / totalEmployeesInUnit) * 100) : 100
      };

      // Sanitize data before sending to client
      const sanitizedData = data.map((row: any) => {
        const clean: any = {}
        for (const key in row) {
          const value = row[key]
          if (value === null || value === undefined) {
            clean[key] = value
          } else if (Array.isArray(value) || typeof value === 'object') {
            try {
              clean[key] = JSON.stringify(value)
            } catch (e) {
              clean[key] = '[Complex Object]'
            }
          } else {
            clean[key] = value
          }
        }
        return clean
      })

      return NextResponse.json({
        success: true,
        data: sanitizedData,
        summary
      })
    } catch (summaryErr) {
      console.error('Error building summary:', summaryErr)
    }

    return NextResponse.json({ success: true, data: [], message: 'Fallback triggered' })
  } catch (error: any) {
    console.error('Report generation error:', error)
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}

/**
 * Generate Incentive Report
 * Uses PIR (Poin Indeks Rupiah) formula:
 * PIR = (net_pool × proportion_unit%) / Total_Skor_Kolektif_Unit
 * Bruto = Skor_Individu × PIR
 * Netto = Bruto - PPh21
 */
async function generateIncentiveReport(supabase: any, period: string, unitId?: string, employeeId?: string) {
  // 1. Get Pool
  const { data: poolData, error: poolError } = await supabase
    .from('t_pool')
    .select('net_pool')
    .eq('period', period)
    .maybeSingle()

  if (!poolData) {
    throw new Error(`Data pool tidak ditemukan untuk periode ${period}. Silakan buat data pool terlebih dahulu di menu Pengaturan Pool.`);
  }

  // 1.5 Get Global Tax Mechanism
  const { data: taxSetting } = await supabase
    .from('t_settings')
    .select('value')
    .eq('key', 'tax_config')
    .maybeSingle()

  const taxMechanism = (taxSetting?.value as any)?.mechanism || 'ter'

  const netPool = Number(poolData.net_pool || 0);

  // 2. Fetch active employees (filtered by unit/employee if specified)
  // 2. Fetch all employees (including inactive if they have assessments)
  // We remove is_active check because if they have assessments in this period, they should be in the report
  let empQuery = supabase
    .from('m_employees')
    .select('*, m_units(id, name, proportion_percentage)')
    .neq('role', 'superadmin')

  if (employeeId && employeeId !== 'all') {
    empQuery = empQuery.eq('id', employeeId)
  } else if (unitId && unitId !== 'all') {
    empQuery = empQuery.eq('unit_id', unitId)
  }

  const { data: allEmployees, error: allEmpError } = await empQuery.range(0, 9999)
  console.log(`[Report] generateIncentiveReport: Fetched ${allEmployees?.length || 0} employees candidates for unit ${unitId}`)

  if (allEmpError) {
    console.error('Error fetching employees:', allEmpError)
    throw new Error('Failed to fetch employee data: ' + JSON.stringify(allEmpError))
  }

  if (!allEmployees || allEmployees.length === 0) {
    console.log(`[Report] No employees found for unit: ${unitId}, emp: ${employeeId}`)
    return []
  }

  const empIds = allEmployees.map((e: any) => e.id)
  console.log(`[Report] Starting assessment fetch for ${empIds.length} employees in period ${period}`)

  // 3. Get assessments for the filtered employees in this period
  // Use batchedIn to avoid PostgREST URL length overflow with large employee sets
  const mainSelectFields = `
    employee_id,
    indicator_id,
    score,
    weight_percentage,
    achievement_percentage,
    realization_value,
    target_value,
    m_kpi_indicators (
      id,
      name,
      weight_percentage,
      base_index_value,
      target_value,
      calculation_method,
      m_kpi_categories (
        category,
        weight_percentage,
        configuration_style,
        is_weighted
      )
    )
  `

  const [allAssessments, subAssessments] = await Promise.all([
    batchedIn(
      supabase,
      't_kpi_assessments',
      mainSelectFields,
      'employee_id',
      empIds,
      q => q.eq('period', period).is('sub_indicator_id', null)
    ),
    batchedIn(
      supabase,
      't_kpi_assessments',
      'employee_id, indicator_id, score, realization_value',
      'employee_id',
      empIds,
      q => q.eq('period', period).not('sub_indicator_id', 'is', null)
    )
  ])

  console.log(`[Report] Fetched ${allAssessments.length} main and ${subAssessments.length} sub-assessments`)

  // Build a lookup: employee_id+indicator_id → aggregated sub-assessment score & realization
  // Used as fallback when main row score is null (legacy data)
  const subScoreMap = new Map<string, { score: number; realization: number }>()
  for (const sub of subAssessments) {
    const key = `${sub.employee_id}:${sub.indicator_id}`
    const existing = subScoreMap.get(key)
    if (existing) {
      existing.score += Number(sub.score || 0)
      existing.realization += Number(sub.realization_value || 0)
    } else {
      subScoreMap.set(key, {
        score: Number(sub.score || 0),
        realization: Number(sub.realization_value || 0)
      })
    }
  }

  if (!allEmployees) return []

  // --- Helper: Calculate total score/activity for an employee ---
  const calcEmployeeTotalScore = (empId: string, isMedicalUnit: boolean) => {
    const empAssessments = allAssessments?.filter((a: any) => a.employee_id === empId) || []
    let totalActivityRupiah = 0
    const assessmentDetails: any[] = []
    const processedIndices = new Set<string>()

    const calcCategoryScore = (categoryName: string) => {
      const catAssessments = empAssessments.filter((a: any) =>
        a.m_kpi_indicators?.m_kpi_categories?.category === categoryName
      )
      if (catAssessments.length === 0) return 0

      const catMeta = catAssessments[0].m_kpi_indicators?.m_kpi_categories || {}
      const categoryWeight = parseFloat(catMeta.weight_percentage) || 0
      const isActivityStyle = catMeta.configuration_style === 'activity'

      const hasAnyIndicatorWeight = catAssessments.some((a: any) => parseFloat(a.weight_percentage) > 0)
      const effectivelyWeighted = catMeta.is_weighted !== false && (categoryWeight > 0 || hasAnyIndicatorWeight)

      let totalRealisasi = 0
      let totalTarget = 0

      for (const a of catAssessments) {
        // Mark as processed so we don't count it again in "others"
        processedIndices.add(`${a.employee_id}:${a.indicator_id}`)

        const indRealization = parseFloat(a.realization_value) || 0
        const basicVal = parseFloat(a.m_kpi_indicators?.base_index_value) || 0
        const rawScore = a.score  // may be null for legacy rows
        const indName = a.m_kpi_indicators?.name || '-'
        const indWeight = parseFloat(a.weight_percentage) || 0
        const indTarget = parseFloat(a.target_value) || 100
        const calcMethod = a.m_kpi_indicators?.calculation_method || 'indexing'

        const isPriority = calcMethod === 'priority'
        const isActivityIndexing = (isActivityStyle || basicVal > 0) && !isPriority

        // Resolve effective score: prefer main row score, fallback to sub-assessment aggregate
        let effectiveScore: number
        if (rawScore !== null && rawScore !== undefined) {
          effectiveScore = parseFloat(rawScore) || 0
        } else {
          const subKey = `${empId}:${a.indicator_id}`
          const subAgg = subScoreMap.get(subKey)
          effectiveScore = subAgg ? subAgg.score : 0
        }

        const indicatorScore = effectiveScore

        let activityValue = 0
        if (isPriority || isActivityIndexing) {
          if (indicatorScore > 0 && (isActivityStyle || basicVal <= 1)) {
            activityValue = indicatorScore
          } else if (basicVal > 1) {
            activityValue = indRealization * basicVal
          } else {
            activityValue = indicatorScore || indRealization
          }
        }

        // Track detail for slip
        assessmentDetails.push({
          name: indName,
          category: categoryName,
          weight: indWeight,
          target: indTarget,
          realization: indRealization,
          score: indicatorScore,
          basic_value: basicVal,
          calculation_method: calcMethod,
          is_weighted: effectivelyWeighted && calcMethod === 'indexing',
          is_activity: isPriority || isActivityIndexing,
          activity_value: activityValue,
          is_priority: isPriority
        })

        if (isPriority || isActivityIndexing) {
          totalActivityRupiah = Number(totalActivityRupiah) + Number(activityValue)
        } else {
          if (isMedicalUnit) {
            totalRealisasi = Number(totalRealisasi) + Number(indRealization)
          } else {
            if (effectivelyWeighted) {
              totalRealisasi = Number(totalRealisasi) + (Number(indRealization) * (Number(indWeight) / 100))
              totalTarget = Number(totalTarget) + (Number(indTarget) * (Number(indWeight) / 100))
            } else {
              const achievement = Number(indTarget) === 0 ? 100 : (Number(indRealization) / Number(indTarget)) * 100
              totalRealisasi = Number(totalRealisasi) + achievement
              totalTarget = Number(totalTarget) + 100
            }
          }
        }
      }

      if (isMedicalUnit) {
        return totalRealisasi
      } else if (!effectivelyWeighted) {
        // Fallback for unweighted: average achievement
        return totalTarget > 0 ? (totalRealisasi / totalTarget) * 100 : 0
      } else if (totalTarget > 0) {
        // Weighted score scaled by category weight
        return (totalRealisasi / totalTarget) * categoryWeight
      }
      return 0
    }

    const p1 = Number(calcCategoryScore('P1').toFixed(2))
    const p2 = Number(calcCategoryScore('P2').toFixed(2))
    const p3 = Number(calcCategoryScore('P3').toFixed(2))

    // Catch-all for assessments in other categories to ensure they are added to assessmentDetails
    const remainingAssessments = empAssessments.filter((a: any) => !processedIndices.has(`${a.employee_id}:${a.indicator_id}`))
    for (const a of remainingAssessments) {
      const indName = a.m_kpi_indicators?.name || '-'
      const catName = a.m_kpi_indicators?.m_kpi_categories?.category || 'Lainnya'
      assessmentDetails.push({
        name: indName,
        category: catName,
        weight: parseFloat(a.weight_percentage) || 0,
        target: parseFloat(a.target_value) || 100,
        realization: parseFloat(a.realization_value) || 0,
        score: parseFloat(a.score) || 0,
        is_weighted: false,
        is_activity: false,
        activity_value: 0
      })
    }

    return {
      p1, p2, p3,
      totalScore: Number((p1 + p2 + p3).toFixed(2)),
      totalActivityRupiah: Number(totalActivityRupiah),
      assessmentDetails
    }
  }

  // --- First pass: calculate ALL employee scores and unit totals ---
  const employeeScoresMap = new Map<string, { emp: any; p1: number; p2: number; p3: number; totalScore: number; totalActivityRupiah: number; assessmentDetails: any[] }>()
  const unitTotalScoresMap = new Map<string, number>()
  const unitTotalActivityMap = new Map<string, number>()
  const unitEmployeeCountMap = new Map<string, number>()

  let skippedNoUnit = 0
  for (const emp of allEmployees) {
    if (!emp.m_units) {
      skippedNoUnit++
      continue
    }
    const unitData = Array.isArray(emp.m_units) ? emp.m_units[0] : emp.m_units
    const uId = unitData?.id
    const isMedical = isMedicalUnit(uId, unitData?.name)

    const scores = calcEmployeeTotalScore(emp.id, isMedical)

    employeeScoresMap.set(emp.id, { emp, ...scores })

    unitTotalScoresMap.set(uId, Number(unitTotalScoresMap.get(uId) || 0) + Number(scores.totalScore))
    unitTotalActivityMap.set(uId, Number(unitTotalActivityMap.get(uId) || 0) + Number(scores.totalActivityRupiah))
    unitEmployeeCountMap.set(uId, Number(unitEmployeeCountMap.get(uId) || 0) + 1)
  }
  if (skippedNoUnit > 0) {
    console.warn(`[Report] WARNING: Skipped ${skippedNoUnit} employees without unit data (m_units is null)`)
  }

  // --- Calculate PIR per unit and save audit trail ---
  const unitPIRMap = new Map<string, number>()

  for (const emp of allEmployees) {
    if (!emp.m_units) continue
    const unitData = Array.isArray(emp.m_units) ? emp.m_units[0] : emp.m_units
    const uId = unitData?.id
    if (!uId || unitPIRMap.has(uId)) continue

    // Determine Style
    const unitName = unitData?.name || '-'
    const isMedical = isMedicalUnit(uId, unitName)
    const unitProp = parseFloat(unitData?.proportion_percentage || '0')
    const totalSkorUnit = unitTotalScoresMap.get(uId) || 0
    const empCount = unitEmployeeCountMap.get(uId) || 0
    const allocatedForUnit = netPool * (unitProp / 100)

    let pir = 0
    const totalActivityValueUnit = unitTotalActivityMap.get(uId) || 0

    if (isMedical) {
      // MEDIS Style PIR Calculation: (Allocated - Aggregate Guarantee Fees - Total Activity Value) / Total Index Points
      const { data: masterDocs } = await supabase
        .from('remunerasi_master_dokter')
        .select('pagu_guarantee_fee')
      // Ideally we filter by employees in this unit

      const totalGuaranteeFee = masterDocs?.reduce((acc: number, d: any) => acc + Number(d.pagu_guarantee_fee), 0) || 0
      const sisaPaguMedis = allocatedForUnit - totalGuaranteeFee - totalActivityValueUnit

      // If sum of deductions exceeds allocated pool, standard handling
      if (sisaPaguMedis <= 0) {
        pir = 0
      } else {
        pir = totalSkorUnit > 0 ? sisaPaguMedis / totalSkorUnit : 0
      }
    } else {
      // STANDARD Style (Non-Medical) with Activity deduction:
      // PIR = (AllocatedForUnit - TotalActivityValueUnit) / TotalSkorUnit
      const remainingPool = allocatedForUnit - totalActivityValueUnit;
      pir = (totalSkorUnit > 0) ? (remainingPool / totalSkorUnit) : 0;
      // Allow slightly negative PIR if activities exceed allocation? Business logic check:
      if (pir < 0) pir = 0;
    }

    unitPIRMap.set(uId, pir)

    // Save audit trail (using original field names)
    // Note: pir_value reflects the merit indices value, 
    // allocated_for_unit is the RAW fund before deduction (to follow history pattern)
    await savePIRHistory(
      supabase, period, uId, unitName,
      netPool, unitProp, allocatedForUnit,
      totalSkorUnit, pir, empCount
    )
  }

  // --- Second pass: Calculate Gross/Net incentive per employee ---
  const report = []

  // Determine which employees to include in the report
  const reportEmployeeIds = new Set<string>()
  for (const emp of allEmployees) {
    const matchUnit = !unitId || unitId === 'all' || emp.unit_id === unitId
    const matchEmp = !employeeId || employeeId === 'all' || emp.id === employeeId
    if (matchUnit && matchEmp) {
      reportEmployeeIds.add(emp.id)
    }
  }

  for (const [empId, data] of employeeScoresMap.entries()) {
    if (!reportEmployeeIds.has(empId)) continue

    const { emp, p1, p2, p3, totalScore, totalActivityRupiah, assessmentDetails } = data

    // Relaxed condition: Include employee if they were fetched in our assessment queries.
    // If they were in empIds and we fetched something (main or sub), they should be here.
    // We already filtered allEmployees down to reportEmployeeIds.
    // JUST check if they have at least one record in assessmentDetails OR if they were part of the assessments fetch.
    const hasAnyAssessment = assessmentDetails.length > 0 || allAssessments.some(a => a.employee_id === empId) || subAssessments.some(s => s.employee_id === empId);

    if (!hasAnyAssessment) continue

    const unitData = Array.isArray(emp.m_units) ? emp.m_units[0] : emp.m_units
    const uId = unitData?.id
    const unitName = unitData?.name || '-'
    const unitProp = parseFloat(unitData?.proportion_percentage || '0')
    const pir = uId ? (unitPIRMap.get(uId) || 0) : 0
    const totalSkorUnit = uId ? (unitTotalScoresMap.get(uId) || 0) : 0

    const isMedical = isMedicalUnit(uId, unitName)

    // Formula: (Total Skor x PIR) + Total Activity Rupiah
    const indexIncentive = totalScore * pir
    let grossIncentive = Number(indexIncentive) + Number(totalActivityRupiah)

    let guaranteeFee = 0
    if (isMedical) {
      // For doctors, also add Guarantee Fee
      const { data: doctorMaster } = await supabase
        .from('remunerasi_master_dokter')
        .select('pagu_guarantee_fee')
        .eq('employee_id', empId)
        .eq('periode_id', period)
        .maybeSingle()

      guaranteeFee = Number(doctorMaster?.pagu_guarantee_fee || 0)
      grossIncentive += guaranteeFee
    }

    // PPh 21
    const taxCheck = calculatePPh21(
      grossIncentive,
      emp.employment_status || emp.employee_status,
      emp.tax_type,
      emp.tax_status,
      emp.pns_grade,
      taxMechanism as any
    )

    // Insentif Netto = Bruto - Pajak
    const netIncentive = grossIncentive - taxCheck.amount

    const mappedNik = emp.nik || emp.NIK || '-'
    const mappedBankName = emp.bank_name || emp.BANK_NAME || emp.nama_bank || '-'
    const mappedBankAccount = emp.bank_account_number || emp.BANK_ACCOUNT_NUMBER || emp.nomor_rekening || '-'
    const mappedBankHolder = emp.bank_account_name || emp.BANK_ACCOUNT_NAME || emp.bank_account_holder || emp.full_name || '-'

    // Extract category weights from assessmentDetails
    const getCatWeight = (cat: string) => {
      const detail = assessmentDetails.find((d: any) => d.category === cat)
      if (!detail) return 0
      // Get from the category metadata in allAssessments
      const catAss = allAssessments?.find((a: any) => a.employee_id === empId && a.m_kpi_indicators?.m_kpi_categories?.category === cat)
      return parseFloat(catAss?.m_kpi_indicators?.m_kpi_categories?.weight_percentage) || 0
    }

    report.push({
      employee_code: emp.employee_code || '-',
      nik: mappedNik,
      employee_name: emp.full_name,
      unit: unitName,
      bank_name: mappedBankName,
      bank_account_number: mappedBankAccount,
      bank_account_holder: mappedBankHolder,
      tax_status: emp.tax_status || 'TK/0',
      employee_status: emp.employment_status || ((emp.employee_status === 'active' || emp.employee_status === 'ASN') ? 'ASN' : (emp.employee_status || 'BLUD')),
      tax_type: (emp.tax_type === 'gross' || emp.tax_type === 'Final') ? 'Final' : (emp.tax_type || 'TER'),
      pns_grade: (emp.pns_grade && emp.pns_grade !== 'null') ? emp.pns_grade : '-',
      tax_mechanism_used: taxMechanism,
      p1_score: p1,
      p2_score: p2,
      p3_score: p3,
      p1_weight: getCatWeight('P1'),
      p2_weight: getCatWeight('P2'),
      p3_weight: getCatWeight('P3'),
      total_score: totalScore,
      pir_value: pir,
      total_activity: totalActivityRupiah,
      total_activity_rupiah: totalActivityRupiah,
      index_incentive: indexIncentive,
      guarantee_fee: guaranteeFee,
      total_skor_unit: Number(totalSkorUnit),
      unit_proportion: Number(unitProp),
      unit_allocation: uId ? (Number(netPool) * (Number(unitProp) / 100)) : 0,
      unit_total_activity: uId ? Number(unitTotalActivityMap.get(uId) || 0) : 0,
      gross_incentive: grossIncentive,
      tax_amount: taxCheck.amount,
      tax_detail: taxCheck.text,
      net_incentive: netIncentive,
      assessment_details: assessmentDetails,
    })
  }

  // Sort by full name for better readability
  report.sort((a, b) => (a.employee_name || '').localeCompare(b.employee_name || ''))

  return report
}

/**
 * Generate KPI Achievement Report
 * Averages out achievement per indicator across all employees in the period.
 */
async function generateKPIAchievementReport(supabase: any, period: string, unitId?: string, employeeId?: string, detailLevel?: string) {
  // Fetch Assessment Data - only main indicator rows (sub_indicator_id IS NULL)
  const kpiSelectFields = `
    realization_value,
    target_value,
    achievement_percentage,
    employee_id,
    m_employees!t_kpi_assessments_employee_id_fkey (
      id,
      full_name,
      nik,
      m_units (
        name
      )
    ),
    m_kpi_indicators!inner (
      id,
      name,
      target_value,
      weight_percentage,
      base_index_value,
      calculation_method,
      m_kpi_categories (
        category,
        configuration_style,
        is_weighted
      )
    )
  `

  let assessments: any[] = []

  if (unitId || employeeId) {
    const matchCriteria: any = {}
    if (employeeId && employeeId !== 'all') {
      matchCriteria.id = employeeId
    } else if (unitId && unitId !== 'all') {
      matchCriteria.unit_id = unitId
    }

    const { data: emps } = await supabase
      .from('m_employees')
      .select('id')
      .match(matchCriteria)
      .range(0, 9999)

    const empIds = emps?.map((e: any) => e.id) || []
    if (empIds.length === 0) return []

    // Use batchedIn to avoid URL overflow with large employee sets
    assessments = await batchedIn(
      supabase,
      't_kpi_assessments',
      kpiSelectFields,
      'employee_id',
      empIds,
      q => q.eq('period', period).is('sub_indicator_id', null)
    )
  } else {
    // No unit/employee filter — fetch all
    const { data, error: assError } = await supabase
      .from('t_kpi_assessments')
      .select(kpiSelectFields)
      .eq('period', period)
      .is('sub_indicator_id', null)
      .range(0, 50000)
    if (assError) throw assError
    assessments = data || []
  }

  const assError = null // already handled above

  if (assError) throw assError

  // Merge Data
  const mergedData = new Map()

  assessments?.forEach((row: any) => {
    const indicatorId = row.m_kpi_indicators.id
    const empId = row.employee_id

    // Group by employee AND indicator so we get individual reports in bulk
    const key = `${indicatorId}_${empId}`

    const existing = mergedData.get(key)
    const empRecord = Array.isArray(row.m_employees) ? row.m_employees[0] : row.m_employees
    const empName = empRecord?.full_name || '-'
    const unitData = Array.isArray(empRecord?.m_units) ? empRecord?.m_units[0] : empRecord?.m_units
    const unitName = unitData?.name || '-'

    const basicVal = parseFloat(row.m_kpi_indicators.base_index_value) || 0
    const catStyle = row.m_kpi_indicators.m_kpi_categories?.configuration_style
    const calcMethod = row.m_kpi_indicators.calculation_method || 'indexing'
    const isWeightedCat = row.m_kpi_indicators.m_kpi_categories?.is_weighted !== false

    const isActivity = catStyle === 'activity' || calcMethod === 'priority' || basicVal > 0

    if (existing) {
      existing.count++
      existing.sum_realization += Number(row.realization_value || 0)
      existing.sum_target_value += Number(row.target_value || row.m_kpi_indicators.target_value || 0)
      existing.sum_score += Number(row.score || 0)
    } else {
      mergedData.set(key, {
        category: row.m_kpi_indicators.m_kpi_categories?.category || '-',
        indicator_name: row.m_kpi_indicators.name,
        weight: row.m_kpi_indicators.weight_percentage,
        employee_name: empName,
        unit_name: unitName,
        is_activity: isActivity,
        is_weighted: isWeightedCat && !isActivity,
        base_index_value: basicVal,
        count: 1,
        sum_realization: Number(row.realization_value || 0),
        sum_target_value: Number(row.target_value || row.m_kpi_indicators.target_value || 0),
        sum_score: Number(row.score || 0),
      })
    }
  })

  // Format array for report
  const reportArray = Array.from(mergedData.values()).map(item => {
    const realization = Number((item.sum_realization / item.count).toFixed(2));
    const target = Number((item.sum_target_value / item.count).toFixed(2));
    const avgScore = Number((item.sum_score / item.count).toFixed(2));

    // Unify achievement logic with generateIncentiveReport: Target 0 means 100% achievement
    const achievement_percentage = target === 0 ? 100 : (realization / target) * 100;

    let score = 0;
    if (item.is_activity) {
      // Unify with incentive logic: value = score || (realization * base)
      score = avgScore || (realization * (item.base_index_value || 0));
    } else if (item.is_weighted) {
      score = (achievement_percentage / 100) * item.weight;
    } else {
      score = achievement_percentage;
    }

    const gap = realization - target;

    return {
      category: item.category,
      indicator_name: item.indicator_name,
      target_value: target.toFixed(2),
      weight: item.weight,
      employee_name: item.employee_name,
      unit_name: item.unit_name,
      realization_value: realization.toFixed(2),
      gap: gap.toFixed(2),
      achievement_percentage: achievement_percentage.toFixed(2),
      score: score.toFixed(2),
      is_activity: item.is_activity
    };
  })

  // Sort by Category (P1, P2, P3) then by Indicator
  reportArray.sort((a, b) => {
    if (a.category === b.category) {
      return a.indicator_name.localeCompare(b.indicator_name);
    }
    return (a.category || '').localeCompare(b.category || '');
  });

  return reportArray
}

/**
 * Generate Unit Comparison Report
 * Uses the dynamically calculated incentive report data to aggregate by unit.
 */
async function generateUnitComparisonReport(supabase: any, period: string, unitId?: string) {
  // Reuse the dynamic incentive generation logic
  const topLevelData = await generateIncentiveReport(supabase, period, unitId)

  // Aggregate by unit
  const unitMap = new Map()

  topLevelData.forEach(row => {
    const uName = row.unit
    if (!unitMap.has(uName)) {
      unitMap.set(uName, {
        unit_name: uName,
        total_score_sum: 0,
        total_activity_sum: 0,
        total_incentive_sum: 0,
        employee_count: 0,
        pir_value: row.pir_value || 0
      })
    }

    const u = unitMap.get(uName)
    u.total_score_sum += Number(row.total_score || 0)
    u.total_activity_sum += Number(row.total_activity || 0)
    u.total_incentive_sum += Number(row.net_incentive || 0)
    u.employee_count++
  })

  // Format Array
  return Array.from(unitMap.values()).map(u => ({
    unit_name: u.unit_name,
    average_score: u.employee_count > 0 ? (u.total_score_sum / u.employee_count) : 0,
    average_priority: u.employee_count > 0 ? (u.total_activity_sum / u.employee_count) : 0,
    total_unit_score: u.total_score_sum,
    total_unit_activity: u.total_activity_sum,
    pir_value: u.pir_value,
    total_incentive: u.total_incentive_sum,
    employee_count: u.employee_count
  }))
}

/**
 * Generate Employee Slip Report
 * Uses enriched data from generateIncentiveReport including assessment_details and category weights.
 */
async function generateEmployeeSlipReport(supabase: any, period: string, unitId?: string, employeeId?: string) {
  // Reuse the dynamic total calculations (now includes assessment_details & weights)
  const topLevelData = await generateIncentiveReport(supabase, period, unitId, employeeId)

  const results = []

  for (const row of topLevelData) {
    const details: any[] = row.assessment_details || []

    // Use actual category weights from the data
    const p1Weight = row.p1_weight || 0
    const p2Weight = row.p2_weight || 0
    const p3Weight = row.p3_weight || 0

    // Build breakdown from assessment_details
    const buildBreakdown = (category: string) => {
      return details
        .filter((d: any) => d.category === category)
        .map((d: any) => {
          const isPriority = d.is_priority || d.calculation_method === 'priority'

          if (isPriority) {
            // Use the pre-calculated activity_value (which correctly uses the score field for priority)
            const actRupiah = Number(d.activity_value) || Number(d.score) || 0
            return {
              indicator: d.name,
              target: '-',
              weight: 'N/A',
              achievement: d.realization.toString(),
              score: actRupiah.toFixed(2),
              is_activity: true,
              tarif: d.basic_value,
            }
          }

          const achievementVal = (Number(d.target) > 0 ? ((Number(d.realization) / Number(d.target)) * 100) : 0)

          return {
            indicator: d.name || '-',
            target: typeof d.target === 'number' ? d.target.toFixed(2) : (parseFloat(d.target) || 0).toFixed(2),
            weight: d.is_weighted ? (Number(d.weight || 0) + '%') : 'N/A',
            achievement: achievementVal.toFixed(2) + '%',
            score: typeof d.score === 'number' ? d.score.toFixed(2) : (parseFloat(d.score) || 0).toFixed(2),
            is_activity: false,
          }
        })
    }

    results.push({
      employee_code: row.employee_code,
      nik: row.nik,
      employee_name: row.employee_name,
      unit: row.unit || '-',
      bank_name: row.bank_name,
      bank_account_number: row.bank_account_number,
      bank_account_holder: row.bank_account_holder,
      tax_status: row.tax_status || 'Non-PKP',
      employee_status: row.employee_status || '-',
      pns_grade: (row.pns_grade && row.pns_grade !== '-' && row.pns_grade !== 'null') ? row.pns_grade : '-',
      tax_type: row.tax_type || '-',
      p1_score: row.p1_score,
      p1_weighted: row.p1_score,
      p1_weight: p1Weight,
      p1_breakdown: buildBreakdown('P1'),
      p2_score: row.p2_score,
      p2_weighted: row.p2_score,
      p2_weight: p2Weight,
      p2_breakdown: buildBreakdown('P2'),
      p3_score: row.p3_score,
      p3_weighted: row.p3_score,
      p3_weight: p3Weight,
      p3_breakdown: buildBreakdown('P3'),
      total_score: row.total_score,
      pir_value: row.pir_value,
      total_activity: row.total_activity,
      total_activity_rupiah: row.total_activity_rupiah,
      index_incentive: row.index_incentive,
      guarantee_fee: row.guarantee_fee,
      total_skor_unit: row.total_skor_unit,
      unit_proportion: row.unit_proportion,
      unit_allocation: row.unit_allocation,
      unit_total_activity: row.unit_total_activity,
      gross_incentive: row.gross_incentive,
      tax_amount: row.tax_amount,
      tax_detail: row.tax_detail || '-',
      net_incentive: row.net_incentive,
      tax_mechanism_used: row.tax_mechanism_used,
    })
  }

  return results
}
