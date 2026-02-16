export interface Point {
  x: number
  y: number
  label: number
}

// New: Detected object with unique ID and metadata
export interface DetectedObject {
  id: string
  geometry: GeoJSON.Geometry
  properties: {
    class: string
    confidence: number
    segmentation_mode: string
    bbox?: number[]
    thumbnail?: string  // Base64 encoded thumbnail
  }
}

export interface SegmentationResult {
  success: boolean
  geojson: GeoJSON.FeatureCollection
  text_prompt?: string  // For text segmentation mode
}

// Segmentation modes
export enum SegmentMode {
  TEXT = 'text'         // Text prompt segmentation (SAM3)
}

// Add Object modes
export enum AddObjectMode {
  NONE = 'none',
  POINT = 'point'  // Click to add single object (immediate extraction)
}

// Loading state for differentiated loading indicators
export interface LoadingState {
  textSegmentation: boolean           // Full-screen blocking for text segmentation
  exportingShapefile: boolean         // Full-screen blocking for shapefile export
  addObjectRequests: Map<string, {    // Track multiple Add Object requests
    id: string
    timestamp: number
    status: 'processing' | 'complete'
  }>
}

// Common text prompts for easy selection
export const COMMON_PROMPTS = [
  'buildings',
  'roads',
  'trees',
  'water bodies',
  'fields',
  'agricultural fields',
  'farmland',
  'river',
  'rooftop'
] as const

