'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Save, AlertCircle, Target, TrendingUp, Copy, LayoutDashboard, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Progress } from '@/components/ui/progress'
import type { AssessmentStatus } from '@/lib/types/assessment.types'
import type { ScoringCriterion } from '@/lib/types/kpi.types'
import { formatDecimal } from '@/lib/utils/format'
import { isMedicalUnit as checkMedicalUnit } from '@/lib/utils/medical-unit'

interface KPISubIndicator {
  id: string
  indicator_id: string
  code: string
  name: string
  target_value: number
  weight_percentage: number
  scoring_criteria: ScoringCriterion[]
  measurement_unit?: string
  description?: string
  measurement_type?: 'scoring' | 'quantitative'
  unit_tariff?: number
  base_index_value?: number
  service_types?: string[]
  tariffs?: Array<{
    id: string
    service_type: string
    name: string
    tariff: number
  }>
}

interface KPIIndicator {
  id: string
  code: string
  name: string
  target_value: number
  weight_percentage: number
  calculation_method: 'indexing' | 'priority'
  base_index_value: number
  measurement_unit?: string
  description?: string
  sub_indicators: KPISubIndicator[]
}

interface KPICategory {
  category: string
  category_name: string
  weight_percentage: number
  configuration_style?: 'index' | 'activity'
  is_weighted?: boolean
  indicators: KPIIndicator[]
}

interface SubAssessmentData {
  id?: string
  sub_indicator_id: string
  realization_value: number
  score: number
}

interface AssessmentData {
  id?: string
  indicator_id: string
  realization_value: number
  achievement_percentage: number
  score: number
  notes: string
  sub_assessments: SubAssessmentData[]
}

interface AssessmentFormDialogProps {
  open: boolean
  onClose: () => void
  employee: AssessmentStatus
  period: string
  onSaved: () => void
}

export default function AssessmentFormDialog({
  open,
  onClose,
  employee,
  period,
  onSaved
}: AssessmentFormDialogProps) {
  const [categories, setCategories] = useState<KPICategory[]>([])
  const [assessments, setAssessments] = useState<Record<string, AssessmentData>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copyingPrevious, setCopyingPrevious] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isMedicalUnit = checkMedicalUnit(employee?.unit_id, employee?.unit_name)

  // Load KPI indicators and existing assessments
  useEffect(() => {
    if (open && employee) {
      loadKPIIndicators()
      loadExistingAssessments()
    }
  }, [open, employee])

  const loadKPIIndicators = async () => {
    try {
      const response = await fetch(`/api/assessment/indicators?employee_id=${employee.employee_id}&period=${period}`)
      if (response.ok) {
        const data = await response.json()
        setCategories(data.indicators || [])
      } else {
        setError('Failed to load KPI indicators')
      }
    } catch (error) {
      setError('Error loading KPI indicators')
      console.error('Error loading KPI indicators:', error)
    }
  }

  const getIndicatorTarget = (indicator: KPIIndicator) => {
    if (indicator.sub_indicators && indicator.sub_indicators.length > 0) {
      const subTargetSum = indicator.sub_indicators.reduce((sum, sub) => {
        const weight = isMedicalUnit ? 1 : (sub.weight_percentage / 100)
        return sum + ((sub.target_value || 0) * weight)
      }, 0)
      if (subTargetSum > 0) return subTargetSum
    }
    return indicator.target_value || 0
  }

  const loadExistingAssessments = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/assessment?employee_id=${employee.employee_id}&period=${period}`)
      if (response.ok) {
        const data = await response.json()
        const assessmentMap: Record<string, AssessmentData> = {}

        data.assessments?.forEach((item: any) => {
          const indicatorId = item.indicator_id

          if (!assessmentMap[indicatorId]) {
            assessmentMap[indicatorId] = {
              indicator_id: indicatorId,
              realization_value: 0,
              achievement_percentage: 0,
              score: 0,
              notes: '',
              sub_assessments: []
            }
          }

          if (item.sub_indicator_id) {
            // This is a sub-assessment row
            assessmentMap[indicatorId].sub_assessments.push({
              id: item.id,
              sub_indicator_id: item.sub_indicator_id,
              realization_value: item.realization_value,
              score: item.score || 0
            })
          } else {
            // This is the main indicator row
            assessmentMap[indicatorId].id = item.id
            assessmentMap[indicatorId].realization_value = item.realization_value
            assessmentMap[indicatorId].achievement_percentage = item.achievement_percentage || 0
            assessmentMap[indicatorId].score = item.score || 0
            assessmentMap[indicatorId].notes = item.notes || ''
          }
        })

        setAssessments(assessmentMap)
      }
    } catch (error) {
      console.error('Error loading existing assessments:', error)
    } finally {
      setLoading(false)
    }
  }

  const calculateAchievement = (realizationValue: number, targetValue: number): number => {
    if (targetValue <= 0) return 0
    return Math.round((realizationValue / targetValue) * 100 * 100) / 100
  }

  const calculateScore = (achievementPercentage: number): number => {
    return achievementPercentage >= 100 ? 100 : achievementPercentage
  }

  const handleRealizationChange = (indicatorId: string, value: string, targetValue: number) => {
    const indicator = categories.flatMap(c => c.indicators).find(i => i.id === indicatorId)
    const category = categories.find(c => c.indicators.some(i => i.id === indicatorId))
    const isActivity = category?.configuration_style === 'activity'

    // For qualitative/regular, realizationValue is the input.
    // For activity Medis without sub_indicators, realizationValue is the VOLUME input.
    const inputRealization = parseFloat(value) || 0

    let achievementPercentage = 0
    let score = 0
    let derivedRealizationValue = inputRealization

    if (indicator) {
      const isPriority = indicator.calculation_method === 'priority' || category?.configuration_style === 'activity'
      const isUnweightedCat = category?.is_weighted === false

      if (isPriority) {
        const tariff = parseFloat(indicator.base_index_value?.toString() || '0')
        score = inputRealization * tariff
        derivedRealizationValue = inputRealization
        achievementPercentage = 100
      } else {
        achievementPercentage = calculateAchievement(inputRealization, targetValue)
        // Score logic: if unweighted category, score is achievement, else it's weighted if needed?
        // Wait, 'score' in t_kpi_assessments for indexing indicators is usually achievement 
        // because the PIR calculation handles the weighting at the unit level.
        // Actually, existing code says: score = calculateScore(achievementPercentage)
        score = calculateScore(achievementPercentage)
      }
    }

    setAssessments(prev => ({
      ...prev,
      [indicatorId]: {
        indicator_id: indicatorId,
        realization_value: derivedRealizationValue,
        achievement_percentage: achievementPercentage,
        score: score,
        notes: prev[indicatorId]?.notes || '',
        sub_assessments: prev[indicatorId]?.sub_assessments || []
      }
    }))
  }

  const handleSubAssessmentChange = (indicatorId: string, subIndicatorId: string, realizationValue: number, score: number) => {
    setAssessments(prev => {
      const current = prev[indicatorId] || {
        indicator_id: indicatorId,
        realization_value: 0,
        achievement_percentage: 0,
        score: 0,
        notes: '',
        sub_assessments: []
      }

      const subAssessments = [...(current.sub_assessments || [])]
      const index = subAssessments.findIndex(s => s.sub_indicator_id === subIndicatorId)

      if (index >= 0) {
        subAssessments[index] = { sub_indicator_id: subIndicatorId, realization_value: realizationValue, score }
      } else {
        subAssessments.push({ sub_indicator_id: subIndicatorId, realization_value: realizationValue, score })
      }

      // Find the indicator to get sub-indicator weights and target
      const indicator = categories.flatMap(c => c.indicators).find(i => i.id === indicatorId)
      let totalAchievement = 0
      let isQuantitativeIndicator = false
      let sumVolumes = 0
      let sumScores = 0

      if (indicator && indicator.sub_indicators.length > 0) {
        // Bottom-up logic: Sum (Skor * Bobot)
        subAssessments.forEach(sub => {
          const subConfig = indicator.sub_indicators.find(s => s.id === sub.sub_indicator_id)
          if (subConfig?.measurement_type === 'quantitative') isQuantitativeIndicator = true

          // For quantitative/activity, weight acts as 1 (so volume*tariff adds up directly)
          const weight = (isMedicalUnit || isQuantitativeIndicator) ? 1 : (subConfig ? (subConfig.weight_percentage / 100) : 0)
          sumScores += (sub.score || 0) * weight
          sumVolumes += (sub.realization_value || 0)
        })

        const maxTarget = getIndicatorTarget(indicator)

        if (isQuantitativeIndicator || isMedicalUnit) {
          totalAchievement = 100 // Placeholder visual
        } else {
          totalAchievement = maxTarget > 0 ? (sumScores / maxTarget) * 100 : 0
        }
      } else {
        totalAchievement = current.achievement_percentage
        sumVolumes = current.realization_value
        sumScores = current.score
      }
      const category = categories.find(c => c.indicators.some(i => i.id === indicatorId))
      const isPriority = indicator && (indicator.calculation_method === 'priority' || category?.configuration_style === 'activity')

      return {
        ...prev,
        [indicatorId]: {
          ...current,
          realization_value: Number(sumVolumes.toFixed(4)),
          sub_assessments: subAssessments,
          achievement_percentage: Number(totalAchievement.toFixed(2)),
          score: isPriority ? Number(sumScores.toFixed(4)) : calculateScore(totalAchievement)
        }
      }
    })
  }

  const handleNotesChange = (indicatorId: string, notes: string) => {
    setAssessments(prev => ({
      ...prev,
      [indicatorId]: {
        ...prev[indicatorId],
        indicator_id: indicatorId,
        notes
      }
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      // Prepare batch data for all indicators
      const batchData = categories.flatMap(category =>
        category.indicators.map((indicator) => {
          const assessment = assessments[indicator.id] || {
            indicator_id: indicator.id,
            realization_value: 0,
            achievement_percentage: 0,
            score: 0,
            notes: '',
            sub_assessments: []
          }

          return {
            id: assessment.id,
            employee_id: employee.employee_id,
            indicator_id: indicator.id,
            period: period,
            realization_value: assessment.realization_value,
            target_value: getIndicatorTarget(indicator),
            weight_percentage: indicator.weight_percentage,
            achievement_percentage: assessment.achievement_percentage,
            score: assessment.score,
            notes: assessment.notes,
            sub_assessments: assessment.sub_assessments.map(sub => ({
              id: sub.id,
              sub_indicator_id: sub.sub_indicator_id,
              realization_value: sub.realization_value,
              score: sub.score
            }))
          }
        })
      )

      const response = await fetch('/api/assessment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batchData)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Gagal menyimpan penilaian')
      }

      // 2. Trigger parent refresh/success handler
      // This will call handleAssessmentSaved in AssessmentTable,
      // which shows the toast success and closes the dialog.
      onSaved()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Gagal menyimpan penilaian')
      console.error('Error saving assessments:', error)
      toast.error('Gagal menyimpan penilaian: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  const handleCopyPrevious = async () => {
    setCopyingPrevious(true)
    setError(null)
    try {
      const response = await fetch(`/api/assessment/previous?employee_id=${employee.employee_id}&current_period=${period}`)
      if (response.ok) {
        const data = await response.json()
        if (data.assessments && data.assessments.length > 0) {
          const assessmentMap: Record<string, AssessmentData> = {}

          data.assessments.forEach((item: any) => {
            const indicatorId = item.indicator_id

            if (!assessmentMap[indicatorId]) {
              assessmentMap[indicatorId] = {
                indicator_id: indicatorId,
                realization_value: 0,
                achievement_percentage: 0,
                score: 0,
                notes: '',
                sub_assessments: []
              }
            }

            if (item.sub_indicator_id) {
              assessmentMap[indicatorId].sub_assessments.push({
                sub_indicator_id: item.sub_indicator_id,
                realization_value: item.realization_value,
                score: item.score || 0
              })
            } else {
              assessmentMap[indicatorId].realization_value = item.realization_value
              assessmentMap[indicatorId].achievement_percentage = item.achievement_percentage || 0
              assessmentMap[indicatorId].score = item.score || 0
              assessmentMap[indicatorId].notes = item.notes || ''
            }
          })

          // Update current state with copied values
          setAssessments((prev) => ({ ...prev, ...assessmentMap }))

          // Show intermediate success toast
          toast.info('Data berhasil disalin, sedang memproses penyimpanan otomatis...')

          // Critical: We need to perform the save using the newly grouped map 
          // because setAssessments state update won't be available immediately for handleSave
          setSaving(true)

          // Refactored save logic for direct batch data
          const batchData = categories.flatMap(category =>
            category.indicators.map((indicator) => {
              const assessment = assessmentMap[indicator.id] || {
                indicator_id: indicator.id,
                realization_value: 0,
                achievement_percentage: 0,
                score: 0,
                notes: '',
                sub_assessments: []
              }

              return {
                employee_id: employee.employee_id,
                indicator_id: indicator.id,
                period: period,
                realization_value: assessment.realization_value,
                target_value: getIndicatorTarget(indicator),
                weight_percentage: indicator.weight_percentage,
                notes: assessment.notes,
                sub_assessments: assessment.sub_assessments,
                assessor_id: '' // API will handle this from session
              }
            })
          )

          const saveResponse = await fetch('/api/assessment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batchData)
          })

          if (!saveResponse.ok) {
            const errorData = await saveResponse.json()
            throw new Error(errorData.error || 'Gagal menyimpan data yang disalin')
          }

          toast.success('Penilaian berhasil disalin dan disimpan!')
          onSaved()
          onClose()
        } else {
          setError('Tidak ada data penilaian sebelumnya untuk disalin.')
        }
      } else {
        setError('Gagal menyalin penilaian sebelumnya.')
      }
    } catch (error) {
      console.error('Error copying previous assessments:', error)
      setError(error instanceof Error ? error.message : 'Terjadi kesalahan saat menyalin data.')
    } finally {
      setCopyingPrevious(false)
      setSaving(false)
    }
  }

  const getAchievementColor = (percentage: number) => {
    if (percentage >= 100) return 'text-green-600'
    if (percentage >= 80) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getAchievementBadge = (percentage: number) => {
    if (percentage >= 100) return 'bg-green-100 text-green-800'
    if (percentage >= 80) return 'bg-yellow-100 text-yellow-800'
    return 'bg-red-100 text-red-800'
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Target className="h-5 w-5 text-blue-600" />
                Penilaian KPI - {employee.full_name}
              </DialogTitle>
              <DialogDescription>
                Periode: {period} • Unit: {employee.unit_name}
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 font-semibold shadow-sm"
              onClick={handleCopyPrevious}
              disabled={saving || copyingPrevious || loading}
            >
              {copyingPrevious ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Copy className="h-4 w-4 mr-2" />
              )}
              {copyingPrevious ? 'Menyalin & Menyimpan...' : 'Salin Penilaian Sebelumnya'}
            </Button>
          </div>
        </DialogHeader>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {/* Real-time Recapitulation & Progress */}
        {!loading && categories.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-2">
            <Card className="bg-blue-50/50 border-blue-100">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-xs font-semibold text-blue-700 uppercase tracking-wider flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Progress Pengisian
                </CardTitle>
              </CardHeader>
              <CardContent className="py-0 px-4 pb-3">
                {(() => {
                  const totalInd = categories.flatMap(c => c.indicators).length
                  const filledInd = Object.keys(assessments).length
                  const pct = totalInd > 0 ? (filledInd / totalInd) * 100 : 0
                  return (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm font-bold">
                        <span>{filledInd} / {totalInd}</span>
                        <span>{Math.round(pct)}%</span>
                      </div>
                      <Progress value={pct} className="h-2" />
                    </div>
                  )
                })()}
              </CardContent>
            </Card>

            {['P1', 'P2', 'P3'].map((catCode) => {
              const category = categories.find(c => c.category === catCode)
              if (!category) return null

              let totalRealisasiKategori = 0
              let totalTargetKategori = 0

              category.indicators.forEach(indicator => {
                const assessment = assessments[indicator.id]
                const indWeight = parseFloat(indicator.weight_percentage.toString()) || 0
                const indTarget = getIndicatorTarget(indicator)
                const indRealisasi = assessment ? assessment.realization_value : 0
                const indScore = assessment ? assessment.score : 0
                const isPriority = indicator.calculation_method === 'priority'

                if (!isPriority) {
                  if (category.is_weighted !== false) {
                    totalRealisasiKategori += (indRealisasi * (indWeight / 100))
                    totalTargetKategori += (indTarget * (indWeight / 100))
                  } else {
                    // Unweighted category: sum indicators as raw achievement vs 100
                    const ach = indTarget > 0 ? (indRealisasi / indTarget) * 100 : 0
                    totalRealisasiKategori += ach
                    totalTargetKategori += 100
                  }
                }
              })

              const porsiKategori = category.weight_percentage
              let kontribusiAkhir = 0
              if (totalTargetKategori > 0) {
                if (category.is_weighted !== false) {
                  kontribusiAkhir = (totalRealisasiKategori / totalTargetKategori) * porsiKategori
                } else {
                  // For unweighted, the "contribution" is just the average achievement percentage
                  kontribusiAkhir = (totalRealisasiKategori / totalTargetKategori) * 100
                }
              }

              return (
                <Card key={catCode} className="border-gray-200">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Total {catCode} ({porsiKategori}%)
                    </CardTitle>
                    <Badge variant="secondary" className="text-[10px] font-medium px-2 py-0 border-blue-200 bg-blue-50 text-blue-700">
                      Poin Akhir: {isMedicalUnit ? totalRealisasiKategori.toFixed(2) : kontribusiAkhir.toFixed(2)}
                    </Badge>
                  </CardHeader>
                  <CardContent className="py-0 px-4 pb-3">
                    <div className="text-xl font-bold text-gray-900 flex items-end">
                      {totalRealisasiKategori.toFixed(2)}
                      <span className="text-sm font-medium text-gray-500 ml-1 mb-0.5">/ {totalTargetKategori.toFixed(2)}</span>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        <div className="space-y-6">
          {loading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-32" />
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {[...Array(2)].map((_, j) => (
                        <Skeleton key={j} className="h-20 w-full" />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : categories.length === 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">Tidak ada indikator KPI yang dikonfigurasi untuk unit ini.</p>
            </div>
          ) : (
            categories.map((category) => (
              <Card key={category.category}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>{category.category} - {category.category_name}</span>
                    <div className="flex gap-2">
                      {category.is_weighted === false && (
                        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                          Tanpa Bobot
                        </Badge>
                      )}
                      {!isMedicalUnit && category.is_weighted !== false && (
                        <Badge variant="outline">
                          Bobot: {category.weight_percentage}%
                        </Badge>
                      )}
                    </div>
                  </CardTitle>
                  <CardDescription>
                    {category.indicators.length} indikator dalam kategori ini
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {category.indicators.map((indicator) => {
                      const assessment = assessments[indicator.id]
                      const realizationValue = assessment?.realization_value || 0
                      const achievementPct = assessment?.achievement_percentage || 0
                      const score = achievementPct // Show achievement as base score
                      const hasSubIndicators = indicator.sub_indicators && indicator.sub_indicators.length > 0

                      return (
                        <div key={indicator.id} className="border rounded-lg p-4 space-y-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <h4 className="font-medium text-gray-900">{indicator.name}</h4>
                              <p className="text-sm text-gray-600">Kode: {indicator.code}</p>
                              {indicator.description && (
                                <p className="text-sm text-gray-500 mt-1">{indicator.description}</p>
                              )}
                            </div>
                            {!isMedicalUnit && (
                              <div className="flex gap-2 ml-4">
                                {indicator.calculation_method === 'priority' ? (
                                  <Badge variant="default" className="bg-purple-600">
                                    Prioritas
                                  </Badge>
                                ) : (
                                  category.is_weighted !== false && (
                                    <Badge variant="outline">
                                      Bobot: {indicator.weight_percentage}%
                                    </Badge>
                                  )
                                )}
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div>
                              <Label className="text-sm font-medium">Target</Label>
                              <div className="mt-1 p-2 bg-gray-50 rounded border text-sm">
                                {formatDecimal(getIndicatorTarget(indicator), 4)}
                                {indicator.measurement_unit && ` ${indicator.measurement_unit}`}
                              </div>
                            </div>

                            {!hasSubIndicators ? (
                              <div>
                                <Label htmlFor={`realization-${indicator.id}`} className="text-sm font-medium">
                                  Realisasi
                                </Label>
                                <Input
                                  id={`realization-${indicator.id}`}
                                  type="number"
                                  step="0.0001"
                                  value={realizationValue || ''}
                                  onChange={(e) => handleRealizationChange(indicator.id, e.target.value, indicator.target_value)}
                                  placeholder="0.0000"
                                  className="mt-1"
                                />
                              </div>
                            ) : (
                              <div className="bg-gray-50 p-2 rounded border">
                                <Label className="text-xs text-gray-500">Summary Realisasi</Label>
                                <div className="text-sm font-semibold">Multiple Sub-items</div>
                              </div>
                            )}

                            <div>
                              <Label className="text-sm font-medium">Pencapaian</Label>
                              <div className="mt-1 p-2 rounded border flex items-center gap-2">
                                <TrendingUp className={cn("h-4 w-4", getAchievementColor(achievementPct))} />
                                <span className={cn("font-semibold", getAchievementColor(achievementPct))}>
                                  {achievementPct.toFixed(2)}%
                                </span>
                              </div>
                            </div>

                            <div>
                              <Label className="text-sm font-medium">Skor Dasar</Label>
                              <div className="mt-1">
                                <Badge className={getAchievementBadge(score)}>
                                  {score.toFixed(2)}
                                </Badge>
                              </div>
                            </div>
                          </div>

                          {/* Render Sub-Indicators if any */}
                          {hasSubIndicators && (
                            <div className="mt-4 pt-4 border-t space-y-3">
                              <Label className="text-sm font-bold text-blue-800">Evaluasi Sub-Indikator</Label>
                              <div className="grid gap-3">
                                {indicator.sub_indicators.map((sub) => {
                                  const subAssessment = assessment?.sub_assessments?.find(sa => sa.sub_indicator_id === sub.id)
                                  const subRealization = subAssessment?.realization_value || 0
                                  const subScore = subAssessment?.score || 0
                                  const isQuantitative = sub.measurement_type === 'quantitative'
                                  const hasCriteria = !isQuantitative && sub.scoring_criteria && sub.scoring_criteria.length > 0

                                  return (
                                    <div key={sub.id} className="bg-blue-50/30 p-3 rounded-lg border border-blue-100">
                                      <div className="flex justify-between items-start mb-2">
                                        <div>
                                          <p className="text-sm font-medium text-gray-800">{sub.name}</p>
                                          <p className="text-xs text-gray-500">
                                            {!isMedicalUnit && `Bobot: ${sub.weight_percentage}%`}
                                            {sub.target_value > 0 && ` • Target: ${sub.target_value}`}
                                            {isQuantitative && ` • Satuan: ${sub.measurement_unit || 'Volume'} • Tarif Dasar / Indeks: ${(sub.base_index_value || 0) >= 1000 ? 'Rp ' + (sub.base_index_value || 0).toLocaleString('id-ID') : formatDecimal(sub.base_index_value || 0, 4)}`}
                                          </p>
                                        </div>
                                        <Badge variant="outline" className="bg-white text-xs">
                                          {isQuantitative ? `Volume: ${subRealization}` : `Skor: ${subScore.toFixed(2)}`}
                                        </Badge>
                                      </div>

                                      {isQuantitative ? (
                                        <div className="space-y-3">
                                          {sub.tariffs && sub.tariffs.length > 0 ? (
                                            <div className="grid gap-2 border rounded-md p-2 bg-white/50">
                                              <Label className="text-[10px] font-bold text-blue-800 uppercase px-1">Daftar Layanan ({sub.tariffs.length})</Label>
                                              {sub.tariffs.map((tariff) => {
                                                return (
                                                  <div key={tariff.id} className="flex items-center gap-2 bg-white p-2 rounded border border-blue-50 shadow-sm">
                                                    <div className="flex-1">
                                                      <p className="text-xs font-semibold">{tariff.name}</p>
                                                      <p className="text-[10px] text-gray-500">Tarif: Rp {tariff.tariff.toLocaleString('id-ID')}</p>
                                                    </div>
                                                    <div className="w-24">
                                                      <Input
                                                        type="number"
                                                        step="0.0001"
                                                        placeholder="Vol"
                                                        className="h-7 text-xs"
                                                        onChange={(e) => {
                                                          const vol = parseFloat(e.target.value) || 0
                                                          const container = e.target.closest('.grid');
                                                          if (container) {
                                                            const inputs = container.querySelectorAll('input');
                                                            let subIndicatorTotal = 0;
                                                            inputs.forEach((input: any, idx) => {
                                                              const t = sub.tariffs![idx];
                                                              const v = parseFloat(input.value) || 0;
                                                              subIndicatorTotal += v * t.tariff;
                                                            });

                                                            const category = categories.find(c => c.indicators.some(i => i.id === indicator.id))
                                                            const isActivity = category?.configuration_style === 'activity'
                                                            let calculatedScore = 0
                                                            if (isActivity) {
                                                              calculatedScore = subIndicatorTotal
                                                            } else {
                                                              calculatedScore = subIndicatorTotal * (sub.base_index_value || 1)
                                                            }

                                                            handleSubAssessmentChange(indicator.id, sub.id, subIndicatorTotal, calculatedScore)
                                                          }
                                                        }}
                                                      />
                                                    </div>
                                                  </div>
                                                )
                                              })}
                                              <div className="flex justify-between items-center px-1 mt-1 border-t pt-2">
                                                <Label className="text-[10px] font-bold">TOTAL REALISASI</Label>
                                                <div className="text-sm font-bold text-blue-700">
                                                  Rp {subRealization.toLocaleString('id-ID')}
                                                </div>
                                              </div>
                                            </div>
                                          ) : (
                                            <div className="flex items-center gap-2">
                                              <div className="flex-1">
                                                <Label className="text-[10px] text-gray-500 mb-1 block">Input Volume ({sub.measurement_unit || 'qty'})</Label>
                                                <Input
                                                  type="number"
                                                  step="0.0001"
                                                  className="h-8 text-sm bg-white"
                                                  placeholder="0.0000"
                                                  value={subRealization || ''}
                                                  onChange={(e) => {
                                                    const vol = parseFloat(e.target.value) || 0
                                                    const sTariff = sub.base_index_value || 0
                                                    const calculatedScore = vol * sTariff

                                                    handleSubAssessmentChange(indicator.id, sub.id, vol, calculatedScore)
                                                  }}
                                                />
                                              </div>
                                              <div className="w-1/3">
                                                <Label className="text-[10px] text-gray-500 mb-1 block">Hasil Skor/Nilai</Label>
                                                <div className="h-8 text-xs bg-gray-100 border rounded flex items-center px-2 font-medium">
                                                  {subScore.toLocaleString('id-ID')}
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      ) : hasCriteria ? (
                                        <div className="flex flex-wrap gap-2 mt-1">
                                          {sub.scoring_criteria.map((criterion, cIdx) => (
                                            <Button
                                              key={cIdx}
                                              type="button"
                                              variant={subScore === criterion.score ? 'default' : 'outline'}
                                              size="sm"
                                              className="h-8 text-xs px-2"
                                              onClick={() => handleSubAssessmentChange(indicator.id, sub.id, criterion.score, criterion.score)}
                                            >
                                              {criterion.label} ({criterion.score})
                                            </Button>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="space-y-1">
                                          <Label className="text-[10px] text-gray-500 mb-1 block">Input Nilai Pencapaian (%)</Label>
                                          <Input
                                            type="number"
                                            className="h-8 text-sm mt-1 bg-white"
                                            placeholder="Ketik nilai..."
                                            value={subRealization || ''}
                                            onChange={(e) => {
                                              const val = parseFloat(e.target.value) || 0
                                              const sTarget = sub.target_value || 100
                                              const sScore = (val / sTarget) * 100
                                              handleSubAssessmentChange(indicator.id, sub.id, val, sScore)
                                            }}
                                          />
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          <div>
                            <Label htmlFor={`notes-${indicator.id}`} className="text-sm font-medium">
                              Catatan (Opsional)
                            </Label>
                            <Textarea
                              id={`notes-${indicator.id}`}
                              value={assessment?.notes || ''}
                              onChange={(e) => handleNotesChange(indicator.id, e.target.value)}
                              placeholder="Tambahkan catatan penilaian..."
                              className="mt-1"
                              rows={2}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div className="flex justify-between items-center pt-4 border-t w-full">
          <div className="flex-1" />
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Batal
            </Button>
            <Button onClick={handleSave} disabled={saving || loading}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Menyimpan...' : 'Simpan Penilaian'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}