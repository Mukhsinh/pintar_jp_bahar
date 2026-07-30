// KPI Types - Consistent type definitions for KPI system

export interface KPICategory {
  id: string
  unit_id: string
  category: 'P1' | 'P2' | 'P3'
  category_name: string
  weight_percentage: number
  description: string | null
  is_active: boolean
  configuration_style?: 'percentage' | 'activity' | null
  is_weighted?: boolean
}

export interface KPIIndicator {
  id: string
  category_id: string
  code: string
  name: string
  target_value: number
  weight_percentage: number
  measurement_unit: string | null
  description: string | null
  is_active: boolean
  base_index_value?: number | null
  calculation_method?: 'indexing' | 'priority' | null
  measurement_type?: 'scoring' | 'quantitative' | null
  unit_tariff?: number | null
  service_types?: string[] | null
}

// Scoring criterion interface
export interface ScoringCriterion {
  score: number
  label: string
}

export interface KPISubIndicator {
  id: string
  indicator_id: string
  code: string
  name: string
  target_value: number
  weight_percentage: number
  scoring_criteria: ScoringCriterion[]
  measurement_unit: string | null
  description: string | null
  is_active: boolean
  measurement_type?: 'scoring' | 'quantitative' | null
  unit_tariff?: number | null
  base_index_value?: number | null
  service_types?: string[] | null
}

// Extended types with relations
export interface KPIIndicatorWithSubIndicators extends KPIIndicator {
  sub_indicators?: KPISubIndicator[]
}

export interface KPICategoryWithIndicators extends KPICategory {
  indicators?: KPIIndicatorWithSubIndicators[]
}

// Form data types for dialogs
export interface SubIndicatorFormData {
  name: string
  description: string
  weight_percentage: string
  target_value: string
  measurement_unit: string
  scoring_criteria: ScoringCriterion[]
}