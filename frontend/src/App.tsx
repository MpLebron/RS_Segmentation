import { useState, useRef, useEffect } from 'react'
import MapView from './components/MapView'
import ControlPanel from './components/ControlPanel'
import ObjectList from './components/ObjectList'
import LoadingOverlay from './components/LoadingOverlay'
import VoiceControl from './components/VoiceControl'
import { DetectedObject, AddObjectMode, LoadingState } from './types'
import { exportShapefile } from './services/api'
import './styles/App.css'

function App() {
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([])
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const [addObjectMode, setAddObjectMode] = useState<AddObjectMode>(AddObjectMode.NONE)
  const [loadingState, setLoadingState] = useState<LoadingState>({
    textSegmentation: false,
    exportingShapefile: false,
    addObjectRequests: new Map()
  })
  const [textPrompt, setTextPrompt] = useState('')
  const [tiffLayer, setTiffLayer] = useState<{
    imageUrl: string
    bounds: { west: number, south: number, east: number, north: number }
  } | null>(null)
  const mapRef = useRef<any>(null)

  // 调试用：暴露 mapRef 到 window 对象
  useEffect(() => {
    (window as any).mapRef = mapRef
    console.log('✅ mapRef 已暴露到 window.mapRef，可以在控制台使用')
  }, [])

  // Handle new objects from segmentation
  const handleObjectsDetected = (newObjects: DetectedObject[]) => {
    setDetectedObjects(prev => [...prev, ...newObjects])
    // Automatically select the first new object to trigger glow animation
    if (newObjects.length > 0) {
      setSelectedObjectId(newObjects[0].id)
    }
  }

  // Delete an object
  const handleDeleteObject = (objectId: string) => {
    setDetectedObjects(prev => prev.filter(obj => obj.id !== objectId))
    if (selectedObjectId === objectId) {
      setSelectedObjectId(null)
    }
  }

  // Update an object's class
  const handleUpdateObject = (objectId: string, newClass: string) => {
    setDetectedObjects(prev =>
      prev.map(obj =>
        obj.id === objectId
          ? {
              ...obj,
              properties: {
                ...obj.properties,
                class: newClass
              }
            }
          : obj
      )
    )
  }

  // Select an object
  const handleSelectObject = (objectId: string) => {
    setSelectedObjectId(objectId)
  }

  // Toggle Add Object mode
  const handleAddObjectToggle = () => {
    setAddObjectMode(prev => prev === AddObjectMode.NONE ? AddObjectMode.POINT : AddObjectMode.NONE)
  }

  // Complete Add Object (keep in Add mode for continuous adding)
  const handleAddObjectComplete = (newObject: DetectedObject) => {
    setDetectedObjects(prev => [...prev, newObject])
    // Automatically select the new object to trigger glow animation
    setSelectedObjectId(newObject.id)
    // Stay in Add mode - don't exit
  }

  // Cancel Add Object
  const handleAddObjectCancel = () => {
    setAddObjectMode(AddObjectMode.NONE)
  }

  // Add pending request to queue
  const handleAddRequestStart = (requestId: string) => {
    setLoadingState(prev => ({
      ...prev,
      addObjectRequests: new Map(prev.addObjectRequests).set(requestId, {
        id: requestId,
        timestamp: Date.now(),
        status: 'processing'
      })
    }))
  }

  // Remove completed request from queue
  const handleAddRequestComplete = (requestId: string) => {
    setLoadingState(prev => {
      const newMap = new Map(prev.addObjectRequests)
      newMap.delete(requestId)
      return { ...prev, addObjectRequests: newMap }
    })
  }

  // Handle TIFF upload
  const handleTiffUploaded = (imageUrl: string, bounds: { west: number, south: number, east: number, north: number }) => {
    setTiffLayer({ imageUrl, bounds })

    // Fly to the TIFF bounds
    if (mapRef.current) {
      const map = mapRef.current.getMap()
      map.fitBounds([
        [bounds.west, bounds.south],
        [bounds.east, bounds.north]
      ], {
        padding: 50,
        duration: 1000
      })
    }
  }

  // Export to Shapefile
  const handleExportShapefile = async () => {
    if (detectedObjects.length === 0) {
      alert('没有可导出的数据，请先进行影像分割')
      return
    }

    // Show loading overlay
    setLoadingState(prev => ({ ...prev, exportingShapefile: true }))

    try {
      // Convert detectedObjects to GeoJSON, filtering out non-serializable properties
      const geojson = {
        type: 'FeatureCollection',
        features: detectedObjects.map(obj => {
          // Extract only shapefile-compatible properties (no arrays, no long strings)
          const cleanProps: Record<string, string | number | null> = {}
          if (obj.properties) {
            for (const [key, value] of Object.entries(obj.properties)) {
              // Skip thumbnail (base64 too long for shapefile) and bbox (array type)
              if (key === 'thumbnail' || key === 'bbox') continue
              if (typeof value === 'string' || typeof value === 'number' || value === null) {
                // Shapefile field names max 10 chars
                cleanProps[key.slice(0, 10)] = value
              }
            }
          }
          return {
            type: 'Feature',
            id: obj.id,
            geometry: obj.geometry,
            properties: cleanProps,
          }
        })
      }

      console.log(`[Export] Exporting ${geojson.features.length} features`)

      // Call export API
      const blob = await exportShapefile(geojson)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'segmentation_shapefile.zip'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Export error:', error)
      alert(`导出失败: ${(error as Error).message}`)
    } finally {
      // Hide loading overlay
      setLoadingState(prev => ({ ...prev, exportingShapefile: false }))
    }
  }

  return (
    <div className="app">
      <LoadingOverlay
        isVisible={loadingState.textSegmentation}
        message="正在分割影像，请稍候..."
      />
      <LoadingOverlay
        isVisible={loadingState.exportingShapefile}
        message="正在导出 Shapefile，请稍候..."
      />
      <ObjectList
        objects={detectedObjects}
        selectedObjectId={selectedObjectId}
        onSelectObject={handleSelectObject}
        onDeleteObject={handleDeleteObject}
        onUpdateObject={handleUpdateObject}
        onAddObject={handleAddObjectToggle}
        addObjectMode={addObjectMode}
        onExportShapefile={handleExportShapefile}
      />
      <div className="map-container">
        <MapView
          mapRef={mapRef}
          detectedObjects={detectedObjects}
          selectedObjectId={selectedObjectId}
          onSelectObject={handleSelectObject}
          addObjectMode={addObjectMode}
          onAddObjectComplete={handleAddObjectComplete}
          onAddObjectCancel={handleAddObjectCancel}
          loadingState={loadingState}
          onAddRequestStart={handleAddRequestStart}
          onAddRequestComplete={handleAddRequestComplete}
          tiffLayer={tiffLayer}
        />
        <VoiceControl
          mapRef={mapRef}
          onObjectsDetected={handleObjectsDetected}
          detectedObjects={detectedObjects}
          onTextSegmentationStart={() => setLoadingState(prev => ({ ...prev, textSegmentation: true }))}
          onTextSegmentationComplete={() => setLoadingState(prev => ({ ...prev, textSegmentation: false }))}
          onExportShapefile={handleExportShapefile}
          onTextPromptChange={setTextPrompt}
        />
      </div>
      <div className="control-panel">
        <ControlPanel
          mapRef={mapRef}
          onObjectsDetected={handleObjectsDetected}
          onTextSegmentationStart={() => setLoadingState(prev => ({ ...prev, textSegmentation: true }))}
          onTextSegmentationComplete={() => setLoadingState(prev => ({ ...prev, textSegmentation: false }))}
          onTiffUploaded={handleTiffUploaded}
          textPrompt={textPrompt}
          onTextPromptChange={setTextPrompt}
          isSegmenting={loadingState.textSegmentation}
        />
      </div>
    </div>
  )
}

export default App
