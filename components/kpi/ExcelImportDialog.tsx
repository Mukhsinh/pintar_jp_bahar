"use client"

import { useState, useRef } from "react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertCircle, FileSpreadsheet, Upload, CheckCircle2, Loader2 } from "lucide-react"
import * as XLSX from "xlsx"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"

interface ExcelImportDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    unitId: string | null
    categoryId?: string | null
    categoryCode?: string | null
    onSuccess: () => void
}

interface ImportRow {
    Category: string
    IndicatorCode: string
    IndicatorName: string
    TargetVolume?: number
    BasicIndexValue?: number
}

export default function ExcelImportDialog({
    open,
    onOpenChange,
    unitId,
    categoryId,
    categoryCode,
    onSuccess,
}: ExcelImportDialogProps) {
    const [file, setFile] = useState<File | null>(null)
    const [isImporting, setIsImporting] = useState(false)
    const [previewData, setPreviewData] = useState<ImportRow[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0]
        if (selectedFile) {
            setFile(selectedFile)
            parseExcel(selectedFile)
        }
    }

    const parseExcel = (file: File) => {
        const reader = new FileReader()
        reader.onload = (e) => {
            const data = new Uint8Array(e.target?.result as ArrayBuffer)
            const workbook = XLSX.read(data, { type: "array" })
            const firstSheetName = workbook.SheetNames[0]
            const worksheet = workbook.Sheets[firstSheetName]
            const jsonData = XLSX.utils.sheet_to_json<ImportRow>(worksheet)

            setPreviewData(jsonData)
        }
        reader.readAsArrayBuffer(file)
    }

    const handleImport = async () => {
        if (!unitId || previewData.length === 0) return

        setIsImporting(true)
        const supabase = createClient()

        try {
            // 1. Group rows by category
            const categoriesMap = new Map<string, ImportRow[]>()
            previewData.forEach((row) => {
                const catName = row.Category || "Uncategorized"
                if (!categoriesMap.has(catName)) {
                    categoriesMap.set(catName, [])
                }
                categoriesMap.get(catName)?.push(row)
            })

            // 2. Process each category
            for (const [catName, rows] of categoriesMap.entries()) {
                let targetCategoryId = categoryId;

                if (!targetCategoryId) {
                    // Try to map catName to 'P1', 'P2', 'P3' or use it if it's already one of those
                    let pCode = catName.toUpperCase().trim();
                    if (!['P1', 'P2', 'P3'].includes(pCode)) {
                        // fallback or mapping logic
                        pCode = 'P1';
                    }

                    // Upsert Category
                    const { data: categoryData, error: catError } = await supabase
                        .from("m_kpi_categories")
                        .upsert(
                            {
                                unit_id: unitId,
                                category: pCode,
                                category_name: catName,
                                weight_percentage: 0,
                                configuration_style: "activity",
                                is_active: true,
                            },
                            { onConflict: "unit_id,category" }
                        )
                        .select()
                        .single()

                    if (catError) throw catError
                    targetCategoryId = categoryData.id
                }

                // Process Indicators for this category
                for (const row of rows) {
                    if (!row.IndicatorName || !row.IndicatorCode) continue;

                    const { error: indError } = await supabase
                        .from("m_kpi_indicators")
                        .upsert(
                            {
                                category_id: targetCategoryId,
                                code: row.IndicatorCode,
                                name: row.IndicatorName,
                                target_value: row.TargetVolume || 0,
                                base_index_value: row.BasicIndexValue || 0,
                                weight_percentage: 100 / rows.length,
                                is_active: true,
                            },
                            { onConflict: "category_id,code" }
                        )

                    if (indError) throw indError
                }
            }

            toast.success("Data KPI berhasil diimpor")
            onSuccess()
            onOpenChange(false)
            resetState()
        } catch (error: any) {
            console.error("Import error:", error)
            toast.error(`Gagal mengimpor data: ${error.message}`)
        } finally {
            setIsImporting(false)
        }
    }

    const resetState = () => {
        setFile(null)
        setPreviewData([])
        if (fileInputRef.current) fileInputRef.current.value = ""
    }

    return (
        <Dialog open={open} onOpenChange={(val) => {
            onOpenChange(val)
            if (!val) resetState()
        }}>
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5 text-green-600" />
                        Import Materi KPI {categoryCode ? `(${categoryCode})` : '(Medis)'}
                    </DialogTitle>
                    <DialogDescription>
                        Unggah file Excel (.xls/.xlsx) untuk mengimpor {categoryId ? 'indikator ke kategori ini' : 'struktur kategori dan indikator'}.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-10 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}>
                        <Upload className="h-10 w-10 text-gray-400 mb-2" />
                        <p className="text-sm text-gray-600 font-medium">
                            {file ? file.name : "Klik untuk memilih file atau drag & drop"}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">Hanya mendukung format .xls and .xlsx</p>
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept=".xls,.xlsx"
                            onChange={handleFileChange}
                        />
                    </div>

                    {previewData.length > 0 && (
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold">Pratinjau Data ({previewData.length} baris)</Label>
                            <div className="max-h-[200px] overflow-auto border rounded-md">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                            <th className="p-2 text-left border-b font-bold">Kategori</th>
                                            <th className="p-2 text-left border-b font-bold">Kode</th>
                                            <th className="p-2 text-left border-b font-bold">Indikator</th>
                                            <th className="p-2 text-right border-b font-bold">Volume</th>
                                            <th className="p-2 text-right border-b font-bold">Indeks</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {previewData.slice(0, 10).map((row, i) => (
                                            <tr key={i} className="hover:bg-gray-50">
                                                <td className="p-2 border-b">{row.Category}</td>
                                                <td className="p-2 border-b">{row.IndicatorCode}</td>
                                                <td className="p-2 border-b">{row.IndicatorName}</td>
                                                <td className="p-2 border-b text-right">{row.TargetVolume}</td>
                                                <td className="p-2 border-b text-right">{row.BasicIndexValue}</td>
                                            </tr>
                                        ))}
                                        {previewData.length > 10 && (
                                            <tr>
                                                <td colSpan={5} className="p-2 text-center text-gray-400 italic">
                                                    ... dan {previewData.length - 10} baris lainnya
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    <div className="bg-blue-50 p-3 rounded-md flex gap-2 items-start">
                        <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5" />
                        <div className="text-xs text-blue-700">
                            <p className="font-bold mb-1">Penting:</p>
                            <ul className="list-disc ml-4 space-y-0.5">
                                <li>Header kolom harus sesuai: Category, IndicatorCode, IndicatorName, TargetVolume, BasicIndexValue.</li>
                                <li>Import ini akan menimpa (upsert) data lama jika unit_id dan kode indikator sama.</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Batal
                    </Button>
                    <Button
                        onClick={handleImport}
                        disabled={!file || isImporting || previewData.length === 0}
                        className="bg-green-600 hover:bg-green-700 text-white"
                    >
                        {isImporting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Mengimpor...
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="h-4 w-4 mr-2" />
                                Konfirmasi Import
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
