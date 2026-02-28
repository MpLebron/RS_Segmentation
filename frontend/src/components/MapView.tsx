import { useState, useMemo, useEffect } from 'react'
import Map, { Source, Layer, MapLayerMouseEvent, Marker } from 'react-map-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import ClassLegend, { getColorForClass } from './ClassLegend'
import Toast from './Toast'
import PendingQueue from './PendingQueue'
import { DetectedObject, AddObjectMode, LoadingState } from '../types'
import { generateUUID } from '../utils/uuid'
import './MapView.css'

const MAPBOX_TOKEN = (import.meta as any).env.VITE_MAPBOX_TOKEN || ''

interface MapViewProps {
  mapRef: any
  detectedObjects: DetectedObject[]
  selectedObjectId: string | null
  onSelectObject: (id: string) => void
  addObjectMode: AddObjectMode
  onAddObjectComplete: (obj: DetectedObject) => void
  onAddObjectCancel: () => void
  loadingState: LoadingState
  onAddRequestStart: (id: string) => void
  onAddRequestComplete: (id: string) => void
  tiffLayer: {
    imageUrl: string
    bounds: { west: number, south: number, east: number, north: number }
  } | null
}

async function waitForStableMap(map: any): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!map.isMoving() && map.loaded()) {
      resolve()
      return
    }

    let done = false
    const tryResolve = () => {
      if (done) return
      if (!map.isMoving() && map.loaded()) {
        done = true
        map.off('moveend', tryResolve)
        map.off('idle', tryResolve)
        resolve()
      }
    }

    map.on('moveend', tryResolve)
    map.on('idle', tryResolve)
    tryResolve()
  })
}

function buildCaptureBounds(map: any) {
  const bounds = map.getBounds()
  const container = map.getContainer()
  const width = container.clientWidth
  const height = container.clientHeight

  const topLeft = map.unproject([0, 0])
  const topRight = map.unproject([width, 0])
  const bottomRight = map.unproject([width, height])
  const bottomLeft = map.unproject([0, height])

  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
    corners: {
      top_left: { lng: topLeft.lng, lat: topLeft.lat },
      top_right: { lng: topRight.lng, lat: topRight.lat },
      bottom_right: { lng: bottomRight.lng, lat: bottomRight.lat },
      bottom_left: { lng: bottomLeft.lng, lat: bottomLeft.lat },
    },
  }
}

function MapView({
  mapRef,
  detectedObjects,
  selectedObjectId,
  onSelectObject,
  addObjectMode,
  onAddObjectComplete,
  onAddObjectCancel,
  loadingState,
  onAddRequestStart,
  onAddRequestComplete,
  tiffLayer
}: MapViewProps) {
  const [viewState, setViewState] = useState({
    longitude: 120.39792120917376,
    latitude: 32.12321322017814,
    zoom: 16
  })
  const [activeToast, setActiveToast] = useState<string | null>(null)
  const [clickMarkers, setClickMarkers] = useState<Array<{id: string, lng: number, lat: number}>>([])
  const [flashProgress, setFlashProgress] = useState<number>(0)

  // Trigger flash animation (3 quick flashes) when object is selected
  useEffect(() => {
    if (selectedObjectId) {
      console.log('🔆 Starting 3x flash for object:', selectedObjectId)
      let startTime: number | null = null
      const duration = 900 // Total 0.9 seconds for 3 flashes
      let animationId: number

      const animate = (timestamp: number) => {
        if (!startTime) startTime = timestamp
        const elapsed = timestamp - startTime
        const progress = Math.min(elapsed / duration, 1)

        setFlashProgress(progress)

        if (progress < 1) {
          animationId = requestAnimationFrame(animate)
        } else {
          setFlashProgress(0)
        }
      }

      animationId = requestAnimationFrame(animate)

      return () => {
        if (animationId) {
          cancelAnimationFrame(animationId)
        }
      }
    } else {
      setFlashProgress(0)
    }
  }, [selectedObjectId])

  // Convert detectedObjects to GeoJSON
  const geojson = useMemo(() => {
    const result = {
      type: 'FeatureCollection' as const,
      features: detectedObjects.map(obj => ({
        type: 'Feature' as const,
        id: obj.id,
        geometry: obj.geometry,
        properties: {
          ...obj.properties,
          id: obj.id  // Add id to properties for easier filtering
        }
      }))
    }
    console.log('📍 GeoJSON features:', result.features.map(f => ({ id: f.id, propId: f.properties?.id, class: f.properties?.class })))
    return result
  }, [detectedObjects])

  // Extract unique classes
  const classes = useMemo(() => {
    const classSet = new Set<string>()
    detectedObjects.forEach(obj => {
      if (obj.properties && obj.properties.class) {
        classSet.add(obj.properties.class)
      }
    })
    return Array.from(classSet)
  }, [detectedObjects])

  const handleMapClick = async (event: MapLayerMouseEvent) => {
    // Check if user is in Add Object mode
    if (addObjectMode === AddObjectMode.POINT) {
      console.log('Add Object mode (POINT) - clicked at:', event.lngLat)
      await handleAddObjectClick(event)
      return
    }

    // Check if clicked on a polygon
    const features = event.features
    console.log('🖱️ Map clicked, features:', features)
    if (features && features.length > 0) {
      const feature = features[0]
      console.log('🎯 Feature:', feature)
      console.log('🎯 Feature.id:', feature.id)
      console.log('🎯 Feature.properties:', feature.properties)

      // Try to get ID from feature.id first, then from properties.id
      const clickedId = (feature.id || feature.properties?.id) as string
      console.log('🎯 Resolved clicked object ID:', clickedId)

      if (clickedId) {
        console.log('📞 Calling onSelectObject with ID:', clickedId)
        onSelectObject(clickedId)
        return
      }
    }

    // No action for regular clicks (removed point selection)
  }

  const handleAddObjectClick = async (event: MapLayerMouseEvent) => {
    const requestId = generateUUID()

    try {
      const { lngLat } = event

      // 1. Add click marker at this location
      setClickMarkers(prev => [...prev, {id: requestId, lng: lngLat.lng, lat: lngLat.lat}])

      // 2. Add to pending queue
      onAddRequestStart(requestId)

      // 3. Show toast notification
      setActiveToast('正在提取对象...')

      const map = mapRef.current?.getMap()
      if (!map) {
        console.error('Map not available')
        onAddObjectCancel()
        onAddRequestComplete(requestId)
        setClickMarkers(prev => prev.filter(m => m.id !== requestId))
        return
      }

      // Wait until camera movement and tile rendering are both stable.
      await waitForStableMap(map)

      // Capture map canvas
      const canvas = map.getCanvas()
      const dataUrl = canvas.toDataURL('image/png')

      // Convert data URL to Blob
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      const file = new File([blob], 'map-capture.png', { type: 'image/png' })

      // Get viewport bounds and corner coordinates for robust geo conversion
      const boundsObj = buildCaptureBounds(map)

      // Load the captured image to get its ACTUAL dimensions
      const img = new Image()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = dataUrl
      })

      // Use the actual captured image dimensions for coordinate calculation
      const actualWidth = img.width
      const actualHeight = img.height

      // Convert geographic click to pixel coordinates
      // Use actual image dimensions instead of assuming devicePixelRatio
      const pixel = map.project([lngLat.lng, lngLat.lat])
      const container = map.getContainer()
      const scaleX = actualWidth / container.clientWidth
      const scaleY = actualHeight / container.clientHeight
      const canvasX = Math.round(pixel.x * scaleX)
      const canvasY = Math.round(pixel.y * scaleY)

      const points = [{
        x: canvasX,
        y: canvasY,
        label: 1
      }]

      // 详细调试日志
      console.log('========== 分割请求详细信息 ==========')
      console.log('1. 点击位置 (地理坐标):', { lng: lngLat.lng, lat: lngLat.lat })
      console.log('2. 屏幕坐标 (CSS像素):', { x: pixel.x, y: pixel.y })
      console.log('3. 画布坐标 (物理像素):', { x: canvasX, y: canvasY })
      console.log('4. 实际捕获图像尺寸:', { width: actualWidth, height: actualHeight })
      console.log('5. 容器尺寸:', { width: container.clientWidth, height: container.clientHeight })
      console.log('6. 计算的缩放比:', { scaleX, scaleY })
      console.log('7. 地图 bounds:', boundsObj)
      console.log('8. 是否有 TIF 图层:', !!tiffLayer)
      if (tiffLayer) {
        console.log('9. TIF bounds:', tiffLayer.bounds)
        console.log('10. TIF 图层信息:', {
          hasWidth: 'width' in tiffLayer,
          hasHeight: 'height' in tiffLayer
        })
      }
      console.log('11. 发送给后端的点坐标:', points)
      console.log('===========================================')

      // Import API function dynamically
      const { segmentSingleObject } = await import('../services/api')

      const result = await segmentSingleObject(file, points, boundsObj)

      if (result.success && result.feature) {
        const newObject: DetectedObject = {
          id: result.feature.id,
          geometry: result.feature.geometry,
          properties: result.feature.properties
        }

        console.log('New object added:', newObject)
        onAddObjectComplete(newObject)
        // 3. Remove from queue and click marker
        onAddRequestComplete(requestId)
        setClickMarkers(prev => prev.filter(m => m.id !== requestId))
        // Note: Stay in Add Object mode for continuous adding
      } else {
        console.error('Add object failed: no feature returned')
        onAddRequestComplete(requestId)
        setClickMarkers(prev => prev.filter(m => m.id !== requestId))
      }
    } catch (error) {
      console.error('Add object error:', error)
      onAddRequestComplete(requestId)
      setClickMarkers(prev => prev.filter(m => m.id !== requestId))
      // Show error toast
      setActiveToast('提取失败，请重试')
    }
  }

  return (
    <div className={`map-view ${addObjectMode === AddObjectMode.POINT ? 'add-object-mode' : ''}`}>
      {activeToast && (
        <Toast
          message={activeToast}
          duration={2000}
          onDismiss={() => setActiveToast(null)}
        />
      )}

      <PendingQueue
        requests={Array.from(loadingState.addObjectRequests.values())}
      />

      <Map
        ref={mapRef}
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        onClick={handleMapClick}
        mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
        mapboxAccessToken={MAPBOX_TOKEN}
        preserveDrawingBuffer={true}
        interactiveLayerIds={['segmentation-layer']}
        dragRotate={false}
        touchPitch={false}
        touchZoomRotate={false}
      >
        {tiffLayer && (
          <Source
            id="tiff-overlay"
            type="image"
            url={tiffLayer.imageUrl}
            coordinates={[
              [tiffLayer.bounds.west, tiffLayer.bounds.north],  // top-left
              [tiffLayer.bounds.east, tiffLayer.bounds.north],  // top-right
              [tiffLayer.bounds.east, tiffLayer.bounds.south],  // bottom-right
              [tiffLayer.bounds.west, tiffLayer.bounds.south]   // bottom-left
            ]}
          >
            <Layer
              id="tiff-layer"
              type="raster"
              paint={{
                'raster-opacity': 0.8,
                'raster-fade-duration': 0
              }}
            />
          </Source>
        )}

        {detectedObjects.length > 0 && (
          <Source
            id="segmentation"
            type="geojson"
            data={geojson}
            promoteId="id"
          >
            {/* 1. Fill layer */}
            <Layer
              id="segmentation-layer"
              type="fill"
              paint={{
                'fill-color': [
                  'match',
                  ['get', 'class'],
                  'buildings', getColorForClass('buildings'),
                  'roads', getColorForClass('roads'),
                  'trees', getColorForClass('trees'),
                  'water bodies', getColorForClass('water bodies'),
                  'river', getColorForClass('river'),
                  'vehicles', getColorForClass('vehicles'),
                  'agricultural fields', getColorForClass('agricultural fields'),
                  'fields', getColorForClass('fields'),
                  'farmland', getColorForClass('farmland'),
                  'farm', getColorForClass('farm'),
                  'crops', getColorForClass('crops'),
                  'parking lots', getColorForClass('parking lots'),
                  'bridges', getColorForClass('bridges'),
                  'auto', getColorForClass('auto'),
                  'points', getColorForClass('points'),
                  'manual', getColorForClass('manual'),
                  '#808080'  // Default color
                ],
                'fill-opacity': [
                  'case',
                  ['==', ['id'], selectedObjectId || ''],
                  0.7,  // Selected object - higher opacity
                  0.4   // Default opacity
                ]
              }}
            />

            {/* 2. Outline layer */}
            <Layer
              id="segmentation-outline"
              type="line"
              paint={{
                'line-color': [
                  'case',
                  ['==', ['id'], selectedObjectId || ''],
                  '#FFFF00',  // Yellow border for selected object
                  [
                    'match',
                    ['get', 'class'],
                    'buildings', getColorForClass('buildings'),
                    'roads', getColorForClass('roads'),
                    'trees', getColorForClass('trees'),
                    'water bodies', getColorForClass('water bodies'),
                    'river', getColorForClass('river'),
                    'vehicles', getColorForClass('vehicles'),
                    'agricultural fields', getColorForClass('agricultural fields'),
                    'fields', getColorForClass('fields'),
                    'farmland', getColorForClass('farmland'),
                    'farm', getColorForClass('farm'),
                    'crops', getColorForClass('crops'),
                    'parking lots', getColorForClass('parking lots'),
                    'bridges', getColorForClass('bridges'),
                    'auto', getColorForClass('auto'),
                    'points', getColorForClass('points'),
                    'manual', getColorForClass('manual'),
                    '#808080'  // Default color
                  ]
                ],
                'line-width': [
                  'case',
                  ['==', ['id'], selectedObjectId || ''],
                  3,  // Thicker border for selected object
                  2   // Default border width
                ]
              }}
            />

            {/* 3. White flash overlay - 3 quick flashes */}
            {selectedObjectId && flashProgress > 0 && (() => {
              // Create 3 pulses using sine wave
              const frequency = 3 // 3 flashes
              const angle = flashProgress * Math.PI * 2 * frequency
              const wave = Math.sin(angle)

              // Only show when wave is positive (above zero)
              // Map wave (0 to 1) to opacity (0 to 0.8)
              const opacity = wave > 0 ? wave * 0.8 : 0

              return (
                <Layer
                  id="segmentation-flash-overlay"
                  type="fill"
                  filter={['==', ['get', 'id'], selectedObjectId]}
                  paint={{
                    'fill-color': '#FFFFFF',
                    'fill-opacity': opacity
                  }}
                />
              )
            })()}
          </Source>
        )}

        {/* Click markers for Add Object mode (immediate extraction - POINT mode) */}
        {clickMarkers.map(marker => (
          <Marker
            key={marker.id}
            longitude={marker.lng}
            latitude={marker.lat}
            anchor="center"
          >
            <div className="click-marker">
              <div className="click-marker-pulse"></div>
              <div className="click-marker-inner"></div>
            </div>
          </Marker>
        ))}
      </Map>

      {classes.length > 0 && <ClassLegend classes={classes} />}
    </div>
  )
}

export default MapView
