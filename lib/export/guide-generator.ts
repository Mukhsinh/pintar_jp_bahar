import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { createAdminClient } from '../supabase/server'

export async function generateSystemGuide(unitId?: string): Promise<Buffer> {
  const adminClient = await createAdminClient()

  // Get settings for Kop Surat
  const { data: settingsData } = await adminClient
    .from('t_settings')
    .select('key, value')
    .in('key', ['company_info', 'footer'])

  let appSettings = {
    appName: 'JASPEL',
    organizationName: 'RUMAH SAKIT SUNGAI BAHAR',
    footerText: ''
  }

  if (settingsData) {
    const companyInfo = (settingsData.find(s => s.key === 'company_info')?.value as any) || {}
    const footerInfo = (settingsData.find(s => s.key === 'footer')?.value as any) || {}
    appSettings.appName = companyInfo.appName || appSettings.appName
    appSettings.organizationName = companyInfo.name || appSettings.organizationName
    appSettings.footerText = typeof footerInfo === 'string' ? footerInfo : (footerInfo.text || '')
  }

  const doc = new jsPDF()

  // Professional Kop Surat
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('PEMERINTAH KABUPATEN MUARO JAMBI', 105, 15, { align: 'center' })
  doc.setFontSize(16)
  doc.text(appSettings.organizationName, 105, 22, { align: 'center' })
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Kabupaten Muaro Jambi, Provinsi Jambi', 105, 28, { align: 'center' })
  doc.text('Email: admin@sungaibahar.com', 105, 33, { align: 'center' })

  doc.setLineWidth(0.5)
  doc.line(20, 38, 190, 38)
  doc.setLineWidth(0.2)
  doc.line(20, 39, 190, 39)

  if (!unitId) {
    // General System Guide
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('PANDUAN SISTEM PENILAIAN KPI (JASPEL)', 105, 50, { align: 'center' })

    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('1. PENDAHULUAN', 20, 65)
    doc.setFont('helvetica', 'normal')
    doc.text('Sistem JASPEL menggunakan metodologi Key Performance Indicator (KPI) untuk mengukur kinerja', 20, 72)
    doc.text('pegawai secara objektif dan transparan. Penilaian terbagi menjadi 3 kategori utama:', 20, 77)

    doc.setFont('helvetica', 'bold')
    doc.text('A. Kategori P1 (Kinerja Utama/Pelayanan)', 25, 87)
    doc.setFont('helvetica', 'normal')
    doc.text('Mengukur output layanan langsung yang diberikan oleh pegawai sesuai dengan tupoksi.', 25, 92)

    doc.setFont('helvetica', 'bold')
    doc.text('B. Kategori P2 (Kinerja Tambahan/Administrasi)', 25, 102)
    doc.setFont('helvetica', 'normal')
    doc.text('Mengukur kontribusi pegawai dalam hal administrasi, pelaporan, dan tugas tambahan.', 25, 107)

    doc.setFont('helvetica', 'bold')
    doc.text('C. Kategori P3 (Perilaku & Kedisiplinan)', 25, 117)
    doc.setFont('helvetica', 'normal')
    doc.text('Mengukur kedisiplinan (absensi) dan perilaku kerja pegawai sehari-hari.', 25, 122)

    doc.setFont('helvetica', 'bold')
    doc.text('2. STRUKTUR PENILAIAN', 20, 137)
    doc.setFont('helvetica', 'normal')
    doc.text('Setiap kategori memiliki indikator, dan setiap indikator dapat dipecah menjadi sub-indikator.', 20, 144)
    doc.text('Total bobot indikator dalam setiap kategori harus mencapai 100%.', 20, 149)

    doc.setFont('helvetica', 'bold')
    doc.text('3. KRITERIA SKORING', 20, 164)
    doc.setFont('helvetica', 'normal')
    doc.text('Skor diberikan dalam skala 1 sampai 5 berdasarkan pencapaian terhadap target yang ditentukan.', 20, 171)

  } else {
    // Unit Specific Guide/Config
    const { data: unit } = await adminClient
      .from('m_units')
      .select('code, name')
      .eq('id', unitId)
      .single()

    if (unit) {
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text('PANDUAN DAN STRUKTUR KPI UNIT', 105, 50, { align: 'center' })
      doc.setFontSize(12)
      doc.text(`${unit.code} - ${unit.name}`, 105, 57, { align: 'center' })

      // Get categories and data
      const { data: categories } = await adminClient
        .from('m_kpi_categories')
        .select('*')
        .eq('unit_id', unitId)
        .eq('is_active', true)
        .order('category')

      let currentY = 70

      for (const cat of categories || []) {
        doc.setFontSize(11)
        doc.setFont('helvetica', 'bold')
        doc.text(`KATEGORI ${cat.category}: ${cat.category_name} (Bobot: ${cat.weight_percentage}%)`, 20, currentY)
        currentY += 7

        const { data: indicators } = await adminClient
          .from('m_kpi_indicators')
          .select('*')
          .eq('category_id', cat.id)
          .eq('is_active', true)
          .order('code')

        const tableBody = []
        for (const ind of indicators || []) {
          tableBody.push([
            { content: ind.code, styles: { fontStyle: 'bold' } },
            { content: ind.name, styles: { fontStyle: 'bold' } },
            `${ind.weight_percentage}%`,
            ind.target_value,
            ind.measurement_unit || '-'
          ])

          const { data: subs } = await adminClient
            .from('m_kpi_sub_indicators')
            .select('*')
            .eq('indicator_id', ind.id)
            .eq('is_active', true)
            .order('code')

          for (const sub of subs || []) {
            let scoringInfo = '-'
            if (sub.scoring_criteria && Array.isArray(sub.scoring_criteria)) {
              scoringInfo = sub.scoring_criteria.map((c: any, i: number) => `S${i + 1}: ${c.label || ''}`).join(', ')
            }

            tableBody.push([
              `  ${sub.code}`,
              `  ${sub.name}\n  (Ket: ${scoringInfo})`,
              `${sub.weight_percentage}%`,
              sub.target_value,
              sub.measurement_unit || '-'
            ])
          }
        }

        autoTable(doc, {
          startY: currentY,
          head: [['Kode', 'Indikator / Sub-Indikator & Petunjuk', 'Bobot', 'Target', 'Satuan']],
          body: tableBody,
          theme: 'grid',
          styles: { fontSize: 8 },
          headStyles: { fillColor: [44, 62, 80] },
          margin: { left: 20, right: 20 }
        })

        currentY = (doc as any).lastAutoTable.finalY + 12
        if (currentY > 250) {
          doc.addPage()
          currentY = 20
        }
      }
    }
  }

  // Final Footer for all pages
  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.text(`Halaman ${i} dari ${pageCount}`, 105, 285, { align: 'center' })
    if (appSettings.footerText) {
      doc.text(appSettings.footerText, 105, 290, { align: 'center' })
    }
  }

  return Buffer.from(doc.output('arraybuffer'))
}
