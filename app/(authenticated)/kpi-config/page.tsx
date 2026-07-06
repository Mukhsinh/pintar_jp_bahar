'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Copy, Download, Building2, FileSpreadsheet, FileText, ChevronDown } from 'lucide-react'
import type {
  KPICategory,
  KPIIndicator,
  KPISubIndicator
} from '@/lib/types/kpi.types'
import { isMedicalUnit as checkMedicalUnit } from '@/lib/utils/medical-unit'

// Direct imports instead of dynamic to fix chunk loading issues
import KPITree from '@/components/kpi/KPITree'
import CategoryFormDialog from '@/components/kpi/CategoryFormDialog'
import IndicatorFormDialog from '@/components/kpi/IndicatorFormDialog'
import SubIndicatorFormDialog from '@/components/kpi/SubIndicatorFormDialog'
import CopyStructureDialog from '@/components/kpi/CopyStructureDialog'
import { getUnitsForKPI, getKPIStructure } from './actions'
import ExcelImportDialog from '@/components/kpi/ExcelImportDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface Unit {
  id: string
  code: string
  name: string
}

export default function KPIConfigPage() {
  const [units, setUnits] = useState<Unit[]>([])
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null)
  const [categories, setCategories] = useState<KPICategory[]>([])
  const [indicators, setIndicators] = useState<KPIIndicator[]>([])
  const [subIndicators, setSubIndicators] = useState<KPISubIndicator[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false)
  const [isIndicatorDialogOpen, setIsIndicatorDialogOpen] = useState(false)
  const [isSubIndicatorDialogOpen, setIsSubIndicatorDialogOpen] = useState(false)
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<KPICategory | null>(null)
  const [selectedIndicator, setSelectedIndicator] = useState<KPIIndicator | null>(null)
  const [selectedSubIndicator, setSelectedSubIndicator] = useState<KPISubIndicator | null>(null)
  const [selectedIndicatorForSub, setSelectedIndicatorForSub] = useState<KPIIndicator | null>(null)
  const [userMetadata, setUserMetadata] = useState<{ role?: string; unit_id?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  const selectedUnitData = units.find(u => u.id === selectedUnit)
  const isMedicalUnit = checkMedicalUnit(selectedUnitData?.id, selectedUnitData?.name)
  const isSuperAdmin = userMetadata?.role === 'superadmin'
  const isUnitManager = userMetadata?.role === 'unit_manager'
  const isReadOnly = isUnitManager

  // Ensure component is mounted before loading data
  useEffect(() => {
    setMounted(true)
    const fetchUser = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const authRole = user.app_metadata?.role || user.user_metadata?.role
        const isSuperAdmin = authRole === 'superadmin' || user.email === 'admin@sungaibahar.com'
        const role = isSuperAdmin ? 'superadmin' : (authRole || 'employee')

        setUserMetadata({
          role: role as any,
          unit_id: user.user_metadata?.unit_id || user.app_metadata?.unit_id
        })
      }
    }
    fetchUser()
  }, [])

  const loadUnits = useCallback(async () => {
    try {
      const result = await getUnitsForKPI()
      if (result.error) throw new Error(result.error)

      const filteredUnits = result.data || []

      setUnits(filteredUnits)
      if (filteredUnits.length > 0 && (!selectedUnit || !filteredUnits.find(u => u.id === selectedUnit))) {
        setSelectedUnit(filteredUnits[0].id)
      }
    } catch (error: any) {
      console.error('Error loading units:', error)
      setError(`Gagal memuat data unit: ${error.message}`)
    } finally {
      setIsLoading(false)
    }
  }, [selectedUnit])

  const loadKPIStructure = useCallback(async () => {
    if (!selectedUnit) return

    setIsLoading(true)
    try {
      const result = await getKPIStructure(selectedUnit)
      if (result.error) throw new Error(result.error)

      // Set all data at once to minimize re-renders
      setCategories(result.categories || [])
      setIndicators(result.indicators || [])
      setSubIndicators(result.subIndicators || [])

    } catch (error: any) {
      console.error('Error loading KPI structure:', error)
      setError(`Gagal memuat struktur KPI: ${error.message}`)
    } finally {
      setIsLoading(false)
    }
  }, [selectedUnit])

  useEffect(() => {
    if (!mounted || userMetadata === null) return

    setError(null)
    loadUnits().catch((err) => {
      console.error('Failed to load units:', err)
      setError('Gagal memuat data unit. Silakan refresh halaman.')
      setIsLoading(false)
    })
  }, [mounted, userMetadata, loadUnits])

  useEffect(() => {
    if (!mounted || !selectedUnit) return

    setError(null)
    loadKPIStructure()
  }, [mounted, selectedUnit, loadKPIStructure])

  const handleAddCategory = useCallback(() => {
    setSelectedCategory(null)
    setIsCategoryDialogOpen(true)
  }, [])

  const handleEditCategory = useCallback((category: KPICategory) => {
    setSelectedCategory(category)
    setIsCategoryDialogOpen(true)
  }, [])

  const handleAddIndicator = useCallback((categoryId: string) => {
    setSelectedCategory(categories.find(c => c.id === categoryId) || null)
    setSelectedIndicator(null)
    setIsIndicatorDialogOpen(true)
  }, [categories])

  const handleEditIndicator = useCallback((indicator: KPIIndicator) => {
    setSelectedIndicator(indicator)
    setIsIndicatorDialogOpen(true)
  }, [])

  const handleAddSubIndicator = useCallback((indicatorId: string) => {
    const ind = indicators.find(i => i.id === indicatorId) || null
    setSelectedIndicatorForSub(ind)
    setSelectedSubIndicator(null)
    setIsSubIndicatorDialogOpen(true)
  }, [indicators])

  const handleEditSubIndicator = useCallback((subIndicator: KPISubIndicator) => {
    // Find parent indicator for context
    const parentIndicator = indicators.find(i => i.id === subIndicator.indicator_id) || null
    setSelectedIndicatorForSub(parentIndicator)
    setSelectedSubIndicator(subIndicator)
    setIsSubIndicatorDialogOpen(true)
  }, [indicators])

  const handleDeleteCategory = useCallback(async (categoryId: string) => {
    const categoryIndicators = indicators.filter(i => i.category_id === categoryId)

    if (categoryIndicators.length > 0) {
      if (!confirm('Kategori ini memiliki indikator. Menghapusnya akan menghapus semua indikator dan sub indikator. Lanjutkan?')) {
        return
      }
    }

    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('m_kpi_categories')
        .delete()
        .eq('id', categoryId)

      if (error) throw error
      await loadKPIStructure()
    } catch (error) {
      console.error('Error deleting category:', error)
      alert('Gagal menghapus kategori')
    }
  }, [indicators, loadKPIStructure])

  const handleDeleteIndicator = useCallback(async (indicatorId: string) => {
    const supabase = createClient()
    const { data: realizationData, error: realizationError } = await supabase
      .from('t_realization')
      .select('id')
      .eq('indicator_id', indicatorId)
      .limit(1)

    if (realizationError) {
      console.error('Error checking realization data:', realizationError)
      return
    }

    if (realizationData && realizationData.length > 0) {
      if (!confirm('Indikator ini memiliki data realisasi. Penghapusan akan mempengaruhi perhitungan historis. Lanjutkan?')) {
        return
      }
    } else {
      if (!confirm('Hapus indikator ini beserta semua sub indikatornya? Tindakan ini tidak dapat dibatalkan.')) {
        return
      }
    }

    try {
      const { error } = await supabase
        .from('m_kpi_indicators')
        .delete()
        .eq('id', indicatorId)

      if (error) throw error
      await loadKPIStructure()
    } catch (error) {
      console.error('Error deleting indicator:', error)
      alert('Gagal menghapus indikator')
    }
  }, [loadKPIStructure])

  const handleDeleteSubIndicator = useCallback(async (subIndicatorId: string) => {
    const subIndicator = subIndicators.find(s => s.id === subIndicatorId)
    if (!subIndicator) return

    if (!confirm(`Apakah Anda yakin ingin menghapus sub indikator "${subIndicator.code} - ${subIndicator.name}"?\n\nTindakan ini tidak dapat dibatalkan.`)) return

    try {
      const supabase = createClient()

      // Check if sub indicator is being used in realization data
      const { data: realizationData, error: checkError } = await supabase
        .from('t_realization')
        .select('id')
        .eq('sub_indicator_id', subIndicatorId)
        .limit(1)

      if (checkError) throw checkError

      if (realizationData && realizationData.length > 0) {
        alert('Sub indikator ini tidak dapat dihapus karena sudah digunakan dalam data realisasi KPI.')
        return
      }

      const { error } = await supabase
        .from('m_kpi_sub_indicators')
        .delete()
        .eq('id', subIndicatorId)

      if (error) throw error

      await loadKPIStructure()
      alert('Sub indikator berhasil dihapus')
    } catch (error: any) {
      console.error('Error deleting sub indicator:', error)
      alert(error.message || 'Gagal menghapus sub indikator')
    }
  }, [subIndicators, loadKPIStructure])

  const handleCopyStructure = useCallback(() => {
    setIsCopyDialogOpen(true)
  }, [])

  const handleCopyComplete = useCallback(async () => {
    await loadKPIStructure()
    setIsCopyDialogOpen(false)
  }, [loadKPIStructure])

  const handleDownloadGuide = useCallback(() => {
    const url = selectedUnit ? `/api/kpi-config/guide?unitId=${selectedUnit}` : '/api/kpi-config/guide'
    window.open(url, '_blank')
  }, [selectedUnit])

  const handleDownloadReport = useCallback((format: 'excel' | 'pdf') => {
    if (!selectedUnit) return
    window.open(`/api/kpi-config/export?unitId=${selectedUnit}&format=${format}`, '_blank')
  }, [selectedUnit])

  if (!mounted || (isLoading && units.length === 0)) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Terjadi Kesalahan</h2>
          <p className="text-red-700 mb-4">{error}</p>
          <Button
            onClick={() => {
              setError(null)
              loadUnits()
            }}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            Coba Lagi
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Konfigurasi KPI</h1>
          <p className="text-gray-600 mt-1">Konfigurasi kategori, indikator, dan sub indikator KPI untuk setiap unit</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleDownloadGuide}
            className="bg-purple-500 hover:bg-purple-600 text-white shadow-md hover:shadow-lg transition-all"
          >
            <Download className="h-4 w-4 mr-2" />
            Petunjuk PDF
          </Button>

          {selectedUnit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transition-all">
                  <Download className="h-4 w-4 mr-2" />
                  Unduh Laporan
                  <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleDownloadReport('excel')} className="cursor-pointer">
                  <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" />
                  Format Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownloadReport('pdf')} className="cursor-pointer">
                  <FileText className="h-4 w-4 mr-2 text-red-600" />
                  Format PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {!isReadOnly && (
            <>
              <Button
                onClick={handleCopyStructure}
                className="bg-cyan-500 hover:bg-cyan-600 text-white shadow-md hover:shadow-lg transition-all"
              >
                <Copy className="h-4 w-4 mr-2" />
                Salin Struktur
              </Button>
              <Button
                onClick={handleAddCategory}
                className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-md hover:shadow-lg transition-all"
              >
                <Plus className="h-4 w-4 mr-2" />
                Tambah Kategori
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Unit Selector - only visible for superadmin */}
      {isSuperAdmin ? (
        <Card className="border-2 border-blue-100 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
            <CardTitle className="flex items-center gap-2 text-blue-900">
              <Building2 className="h-5 w-5" />
              <span className="text-xl">Pilih Unit</span>
              <span className="text-sm font-normal text-blue-600 bg-blue-100 px-2 py-1 rounded-full">
                {units.length} unit
              </span>
            </CardTitle>
            <CardDescription className="text-blue-700">Pilih unit untuk melihat dan mengkonfigurasi struktur KPI</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <Select value={selectedUnit || undefined} onValueChange={setSelectedUnit}>
              <SelectTrigger className="w-full h-14 text-base font-medium border-2 border-blue-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 bg-white hover:bg-blue-50 hover:border-blue-300 transition-all shadow-sm">
                <SelectValue placeholder="Pilih unit..." />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {units.map(unit => (
                  <SelectItem
                    key={unit.id}
                    value={unit.id}
                    className="text-base py-3 cursor-pointer hover:bg-blue-50 focus:bg-blue-100"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded">{unit.code}</span>
                      <span className="text-gray-700">{unit.name}</span>
                      {checkMedicalUnit(unit.id, unit.name) && (
                        <Badge variant="secondary" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200 px-1">Medis</Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      ) : (
        /* For Unit Manager, show their unit information clearly but without selector */
        selectedUnitData && (
          <Card className="border-l-4 border-blue-600 shadow-md">
            <CardContent className="py-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-50 rounded-full text-blue-600">
                  <Building2 className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selectedUnitData.name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-blue-700 border-blue-200 bg-blue-50 font-bold">
                      {selectedUnitData.code}
                    </Badge>
                    {isMedicalUnit && (
                      <Badge className="bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-100">
                        Unit Medis
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right hidden md:block">
                <p className="text-sm font-medium text-gray-500">Mode Akses</p>
                <p className="text-base font-bold text-blue-700">Manager Unit</p>
              </div>
            </CardContent>
          </Card>
        )
      )}

      {/* KPI Tree */}
      {selectedUnit && (
        <Card>
          <CardHeader>
            <CardTitle>Struktur KPI</CardTitle>
            <CardDescription>
              Kategori (P1, P2, P3) → Indikator → Sub Indikator (dengan nilai skor)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <KPITree
                categories={categories}
                indicators={indicators}
                subIndicators={subIndicators}
                onEditCategory={handleEditCategory}
                onDeleteCategory={handleDeleteCategory}
                onAddIndicator={handleAddIndicator}
                onEditIndicator={handleEditIndicator}
                onDeleteIndicator={handleDeleteIndicator}
                onAddSubIndicator={handleAddSubIndicator}
                onEditSubIndicator={handleEditSubIndicator}
                onDeleteSubIndicator={handleDeleteSubIndicator}
                isReadOnly={isReadOnly}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      <CategoryFormDialog
        open={isCategoryDialogOpen}
        onOpenChange={setIsCategoryDialogOpen}
        category={selectedCategory}
        unitId={selectedUnit}
        existingCategories={categories}
        onSuccess={loadKPIStructure}
      />

      <IndicatorFormDialog
        open={isIndicatorDialogOpen}
        onOpenChange={setIsIndicatorDialogOpen}
        indicator={selectedIndicator}
        category={selectedCategory}
        existingIndicators={indicators.filter(i => i.category_id === selectedCategory?.id)}
        onSuccess={loadKPIStructure}
        isMedicalUnit={isMedicalUnit}
      />

      <SubIndicatorFormDialog
        open={isSubIndicatorDialogOpen}
        onOpenChange={setIsSubIndicatorDialogOpen}
        subIndicator={selectedSubIndicator}
        indicator={selectedIndicatorForSub}
        existingSubIndicators={subIndicators.filter(s => s.indicator_id === selectedIndicatorForSub?.id)}
        onSuccess={loadKPIStructure}
        isMedicalUnit={isMedicalUnit}
      />

      <CopyStructureDialog
        open={isCopyDialogOpen}
        onOpenChange={setIsCopyDialogOpen}
        units={units}
        sourceUnitId={selectedUnit}
        onSuccess={handleCopyComplete}
      />
    </div>
  )
}
