import { useState } from 'react'
import { segmentImageWithText } from '../services/api'
import { COMMON_PROMPTS, DetectedObject } from '../types'
import { generateUUID } from '../utils/uuid'
import TiffUploader from './TiffUploader'
import './ControlPanel.css'

interface ControlPanelProps {
  onObjectsDetected: (objects: DetectedObject[]) => void
  mapRef: any
  onTextSegmentationStart: () => void
  onTextSegmentationComplete: () => void
  onTiffUploaded: (imageUrl: string, bounds: { west: number, south: number, east: number, north: number }) => void
  textPrompt: string
  onTextPromptChange: (prompt: string) => void
  isSegmenting: boolean
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

function ControlPanel({ onObjectsDetected, mapRef, onTextSegmentationStart, onTextSegmentationComplete, onTiffUploaded, textPrompt, onTextPromptChange, isSegmenting }: ControlPanelProps) {
  const [error, setError] = useState<string | null>(null)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)

  const captureMapView = async () => {
    if (!mapRef.current) {
      setError('地图未加载')
      return null
    }

    try {
      const map = mapRef.current.getMap()

      // 等待地图视图稳定（停止移动 + 渲染完成），避免截图与 bounds 不一致
      await waitForStableMap(map)

      const canvas = map.getCanvas()
      const dataUrl = canvas.toDataURL('image/png')

      console.log('Captured image, data URL length:', dataUrl.length)
      setCapturedImage(dataUrl)  // 保存截图用于预览
      setError(null)

      return {
        dataUrl,
        bounds: buildCaptureBounds(map),
        size: {
          width: canvas.width,
          height: canvas.height
        }
      }
    } catch (err) {
      setError('截图失败: ' + (err as Error).message)
      return null
    }
  }

  const handleSegment = async () => {
    // Validation
    if (!textPrompt.trim()) {
      setError('请输入文本提示词（如: buildings, roads, trees）')
      return
    }

    setError(null)
    onTextSegmentationStart()  // Trigger blocking overlay

    try {
      // 捕获当前地图视图
      const mapData = await captureMapView()
      if (!mapData) {
        onTextSegmentationComplete()
        return
      }

      console.log('Captured image data URL length:', mapData.dataUrl.length)

      // 将 dataUrl 转换为 Blob
      const response = await fetch(mapData.dataUrl)
      const blob = await response.blob()
      const file = new File([blob], 'map-capture.png', { type: 'image/png' })

      const boundsObj = mapData.bounds

      // Text-based segmentation
      console.log('Text prompt:', textPrompt)
      const result = await segmentImageWithText(
        file,
        textPrompt.trim(),
        boundsObj
      )

      console.log('Segmentation result:', result)

      if (result && result.geojson && result.geojson.features && result.geojson.features.length > 0) {
        console.log('Setting segmentation result with', result.geojson.features.length, 'features')

        // Convert GeoJSON features to DetectedObject[]
        const newObjects: DetectedObject[] = result.geojson.features.map((feature: any) => ({
          id: feature.id || generateUUID(),
          geometry: feature.geometry,
          properties: feature.properties
        }))

        onObjectsDetected(newObjects)
        setError(null)
      } else {
        setError('分割结果为空，未检测到任何对象')
      }
    } catch (err) {
      setError('分割失败: ' + (err as Error).message)
    } finally {
      onTextSegmentationComplete()  // Close overlay
    }
  }

  const handlePromptSelect = (prompt: string) => {
    onTextPromptChange(prompt)
  }

  return (
    <div className="control-panel-content">
      <div className="panel-header">
        <h1>佳格图像分割智能体</h1>
      </div>

      <div className="panel-section">
        <h2>影像导入</h2>
        <TiffUploader onTiffUploaded={onTiffUploaded} />
      </div>

      <div className="panel-section">
        <h2>文本提示</h2>
        <input
          type="text"
          className="text-input"
          placeholder="输入对象类型，如: buildings, roads, trees"
          value={textPrompt}
          onChange={(e) => onTextPromptChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && textPrompt.trim()) {
              handleSegment()
            }
          }}
        />

        <h3>常用提示词</h3>
        <div className="prompt-chips">
          {COMMON_PROMPTS.map(prompt => (
            <button
              key={prompt}
              className={textPrompt === prompt ? 'chip active' : 'chip'}
              onClick={() => handlePromptSelect(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {capturedImage && (
        <div className="panel-section">
          <h2>当前视图</h2>
          <img src={capturedImage} alt="Map capture" className="map-preview" />
        </div>
      )}

      <div className="panel-section">
        <h2>执行分割</h2>
        <button
          onClick={handleSegment}
          disabled={isSegmenting || !textPrompt.trim()}
          className="btn-primary"
        >
          {isSegmenting ? '处理中...' : '开始分割'}
        </button>
        {error && <p className="error-message">{error}</p>}
      </div>

      <div className="panel-footer">
        <p className="info-text">
          提示: 使用英文描述对象类型，如 "buildings" 或 "trees"
        </p>
      </div>
    </div>
  )
}

export default ControlPanel
