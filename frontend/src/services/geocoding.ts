// Mapbox Geocoding API for resolving place names to coordinates

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''

export interface GeocodingResult {
  found: boolean
  coordinates?: [number, number]  // [lng, lat]
  bbox?: [number, number, number, number]  // [west, south, east, north]
  placeName?: string
}

export async function geocodePlace(placeName: string): Promise<GeocodingResult> {
  if (!MAPBOX_TOKEN) {
    console.error('VITE_MAPBOX_TOKEN not configured')
    return { found: false }
  }

  const encodedName = encodeURIComponent(placeName)
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedName}.json`
  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    language: 'zh',
    country: 'cn',
    limit: '1',
    proximity: '116.4,39.9',  // Bias toward central China
  })

  try {
    const response = await fetch(`${url}?${params}`)
    if (!response.ok) {
      console.error('Geocoding API error:', response.status)
      return { found: false }
    }

    const data = await response.json()
    if (!data.features || data.features.length === 0) {
      return { found: false }
    }

    const feature = data.features[0]
    return {
      found: true,
      coordinates: feature.geometry.coordinates as [number, number],
      bbox: feature.bbox as [number, number, number, number] | undefined,
      placeName: feature.place_name,
    }
  } catch (err) {
    console.error('Geocoding request failed:', err)
    return { found: false }
  }
}
