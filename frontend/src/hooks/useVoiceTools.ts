import { useCallback, useMemo, useRef, useEffect } from 'react'
import type { ToolDefinition } from '../types/voice'
import type { DetectedObject } from '../types'
import { OBJECT_TYPE_MAP } from '../config/voiceConfig'
import { geocodePlace } from '../services/geocoding'
import { segmentImageWithText } from '../services/api'
import { generateUUID } from '../utils/uuid'

interface UseVoiceToolsOptions {
  mapRef: React.RefObject<any>
  onObjectsDetected: (objects: DetectedObject[]) => void
  detectedObjects: DetectedObject[]
  onTextSegmentationStart: () => void
  onTextSegmentationComplete: () => void
  onExportShapefile: () => void
  onTextPromptChange: (prompt: string) => void
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

async function waitForMoveEnd(map: any, timeoutMs: number = 3000): Promise<void> {
  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      map.off('moveend', finish)
      resolve()
    }

    map.on('moveend', finish)
    setTimeout(finish, timeoutMs)
  })
}

// Capture current map view and run text-based segmentation
async function captureAndSegment(
  mapRef: React.RefObject<any>,
  textPrompt: string,
  onObjectsDetected: (objs: DetectedObject[]) => void,
  onStart: () => void,
  onComplete: () => void,
): Promise<{ count: number; error?: string }> {
  onStart()
  try {
    const map = mapRef.current?.getMap()
    if (!map) return { count: 0, error: '地图未加载' }

    // Wait until camera movement and tile rendering are both stable.
    await waitForStableMap(map)

    // Capture map canvas
    const canvas = map.getCanvas()
    const dataUrl = canvas.toDataURL('image/png')

    // Convert data URL to File
    const resp = await fetch(dataUrl)
    const blob = await resp.blob()
    const file = new File([blob], 'map-capture.png', { type: 'image/png' })

    // Get geographic bounds
    const boundsObj = buildCaptureBounds(map)

    // Call segmentation API
    const result = await segmentImageWithText(file, textPrompt, boundsObj)

    if (result?.geojson?.features?.length > 0) {
      const newObjects: DetectedObject[] = result.geojson.features.map((f: any) => ({
        id: f.id || generateUUID(),
        geometry: f.geometry,
        properties: f.properties,
      }))
      onObjectsDetected(newObjects)
      return { count: newObjects.length }
    }
    return { count: 0, error: '未检测到任何对象' }
  } catch (err) {
    return { count: 0, error: (err as Error).message }
  } finally {
    onComplete()
  }
}

export function useVoiceTools(options: UseVoiceToolsOptions) {
  const {
    mapRef,
    onObjectsDetected,
    detectedObjects,
    onTextSegmentationStart,
    onTextSegmentationComplete,
    onExportShapefile,
    onTextPromptChange,
  } = options

  // Use refs to always access latest values in async callbacks
  // This avoids the stale closure problem where useCallback captures old values
  const detectedObjectsRef = useRef(detectedObjects)
  useEffect(() => {
    detectedObjectsRef.current = detectedObjects
  }, [detectedObjects])

  const onExportShapefileRef = useRef(onExportShapefile)
  useEffect(() => {
    onExportShapefileRef.current = onExportShapefile
  }, [onExportShapefile])

  const toolDefinitions: ToolDefinition[] = useMemo(() => [
    {
      type: 'function',
      name: 'locate_place',
      description: '在地图上定位到指定的地点。用户说"定位到某某村/镇/市"或"去某某地方看看"时调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          place_name: {
            type: 'string',
            description: '要定位的地名，例如："三星村"、"西来桥镇"、"扬中市"、"江苏省镇江市"',
          },
        },
        required: ['place_name'],
      },
    } as ToolDefinition,
    {
      type: 'function',
      name: 'extract_objects',
      description: '从当前地图视图中提取/识别指定类型的地物对象。用户说"提取田块"、"识别道路"、"帮我找出房屋"等时调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          object_type: {
            type: 'string',
            description: '要提取的对象类型（中文），如：田块、道路、房屋、建筑、树木、水体、河流、农田、作物、屋顶',
          },
        },
        required: ['object_type'],
      },
    } as ToolDefinition,
    {
      type: 'function',
      name: 'zoom_map',
      description: '调整地图的缩放层级。用户说"放大地图"、"缩小一点"、"放大到最大"、"缩放到第15级"、"看近一点"、"拉远一些"时调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '缩放动作：zoom_in（放大）、zoom_out（缩小）、zoom_to（缩放到指定层级）',
            enum: ['zoom_in', 'zoom_out', 'zoom_to'],
          },
          level: {
            type: 'number',
            description: '目标缩放层级（1-20），仅在action为zoom_to时需要。1为最远（全球），20为最近（建筑级别）。常用：10=城市，13=乡镇，15=村庄，17=建筑，19=细节',
          },
          steps: {
            type: 'number',
            description: '放大或缩小的步数，默认为2。用户说"放大很多"可设为4-5，"稍微放大一点"可设为1',
          },
        },
        required: ['action'],
      },
    } as ToolDefinition,
    {
      type: 'function',
      name: 'export_data',
      description: '导出当前检测到的所有对象数据为Shapefile格式并下载。用户说"导出数据"、"下载数据"、"导出Shapefile"时调用此工具。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    } as ToolDefinition,
  ], [])

  const handleToolCall = useCallback(async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    console.log(`[Voice Tool] Executing: ${name}`, args)

    switch (name) {
      case 'locate_place': {
        const placeName = args.place_name as string
        if (!placeName) return '请提供要定位的地名'

        const result = await geocodePlace(placeName)
        if (!result.found) {
          return `未找到"${placeName}"，请提供更详细的地名，例如加上省市名称`
        }

        const map = mapRef.current?.getMap()
        if (!map) return '地图未加载'

        if (result.bbox) {
          map.fitBounds(
            [[result.bbox[0], result.bbox[1]], [result.bbox[2], result.bbox[3]]],
            { padding: 50, duration: 2000 }
          )
        } else if (result.coordinates) {
          map.flyTo({
            center: result.coordinates,
            zoom: 14,
            duration: 2000,
          })
        }

        // Ensure any camera transition is fully settled before next tool runs.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        if (map.isMoving()) {
          await waitForMoveEnd(map, 3000)
        }
        await waitForStableMap(map)

        return `已定位到${result.placeName || placeName}`
      }

      case 'extract_objects': {
        const objectType = args.object_type as string
        if (!objectType) return '请提供要提取的对象类型'

        // Map Chinese type to English prompt for SAM3
        const englishPrompt = OBJECT_TYPE_MAP[objectType] || objectType

        // Sync text prompt to ControlPanel UI
        onTextPromptChange(englishPrompt)

        const result = await captureAndSegment(
          mapRef,
          englishPrompt,
          onObjectsDetected,
          onTextSegmentationStart,
          onTextSegmentationComplete,
        )

        if (result.error) {
          return `分割失败: ${result.error}`
        }
        if (result.count === 0) {
          return `在当前视图中未检测到${objectType}`
        }
        return `已成功提取${result.count}个${objectType}对象`
      }

      case 'zoom_map': {
        const map = mapRef.current?.getMap()
        if (!map) return '地图未加载'

        const action = args.action as string
        const currentZoom = map.getZoom()
        const steps = (args.steps as number) || 2

        switch (action) {
          case 'zoom_in': {
            const newZoom = Math.min(currentZoom + steps, 20)
            map.zoomTo(newZoom, { duration: 1000 })
            return `已放大地图，当前缩放层级：${newZoom.toFixed(1)}`
          }
          case 'zoom_out': {
            const newZoom = Math.max(currentZoom - steps, 1)
            map.zoomTo(newZoom, { duration: 1000 })
            return `已缩小地图，当前缩放层级：${newZoom.toFixed(1)}`
          }
          case 'zoom_to': {
            const level = args.level as number
            if (!level || level < 1 || level > 20) return '缩放层级需要在1到20之间'
            map.zoomTo(level, { duration: 1000 })
            return `已将地图缩放到第${level}级`
          }
          default:
            return `未知的缩放动作: ${action}`
        }
      }

      case 'export_data': {
        const currentObjects = detectedObjectsRef.current
        if (currentObjects.length === 0) {
          return '当前没有可导出的对象数据，请先进行影像分割'
        }
        onExportShapefileRef.current()
        return `正在导出${currentObjects.length}个对象的Shapefile数据`
      }

      default:
        return `未知的工具: ${name}`
    }
  }, [mapRef, onObjectsDetected, onTextSegmentationStart, onTextSegmentationComplete, onTextPromptChange])

  return {
    toolDefinitions,
    handleToolCall,
  }
}
