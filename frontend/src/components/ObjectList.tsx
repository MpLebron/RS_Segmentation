import React, { useState, useRef, useEffect } from 'react'
import { DetectedObject, AddObjectMode } from '../types'
import {
  ChevronUpIcon,
  ChevronDownIcon,
  PlusCircleIcon,
  CheckCircleIcon,
  ArchiveBoxIcon,
  PencilSquareIcon,
  TrashIcon
} from '@heroicons/react/24/outline'
import './ObjectList.css'

interface ObjectListProps {
  objects: DetectedObject[]
  selectedObjectId: string | null
  onSelectObject: (id: string) => void
  onDeleteObject: (id: string) => void
  onAddObject: () => void
  addObjectMode: AddObjectMode
  onExportShapefile: () => void
  onUpdateObject: (id: string, newClass: string) => void
}

// Color mapping from ClassLegend
const COLOR_MAP: Record<string, string> = {
  'buildings': '#FF5733',        // 橙红色 - 建筑物
  'roads': '#888888',            // 灰色 - 道路
  'trees': '#228B22',            // 深绿色 - 树木
  'water bodies': '#1E90FF',     // 天蓝色 - 水体
  'river': '#00FF00',            // 亮绿色 - 河流
  'vehicles': '#FFD700',         // 金黄色 - 车辆
  'agricultural fields': '#32CD32',  // 鲜绿色 - 农田（更明显）
  'fields': '#32CD32',           // 鲜绿色 - 农田
  'farmland': '#90EE90',         // 浅绿色 - 农田
  'farm': '#90EE90',             // 浅绿色 - 农场
  'crops': '#7CFC00',            // 草绿色 - 作物
  'parking lots': '#A9A9A9',     // 深灰色 - 停车场
  'bridges': '#CD853F',          // 褐黄色 - 桥梁
  'auto': '#9400D3',             // 紫色 - 自动检测
  'points': '#FF0000',           // 红色 - 点选
  'manual': '#00FF00'            // 绿色 - 手动添加
}

const getColorForClass = (className: string): string => {
  return COLOR_MAP[className] || '#808080'
}

const ObjectList: React.FC<ObjectListProps> = ({
  objects,
  selectedObjectId,
  onSelectObject,
  onDeleteObject,
  onAddObject,
  addObjectMode,
  onExportShapefile,
  onUpdateObject
}) => {
  const isAddMode = addObjectMode === AddObjectMode.POINT
  const [isMinimized, setIsMinimized] = useState(false)
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null)
  const [editingClass, setEditingClass] = useState('')

  // Create refs for each object item to enable scrolling
  const objectRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Scroll to selected object when selectedObjectId changes
  useEffect(() => {
    if (selectedObjectId && !isMinimized) {
      console.log('🔍 Attempting to scroll to object:', selectedObjectId)
      console.log('📋 Available refs:', Array.from(objectRefs.current.keys()))
      const element = objectRefs.current.get(selectedObjectId)
      if (element) {
        console.log('✅ Element found, scrolling...')
        // Use smooth scrolling with "center" alignment
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        })
      } else {
        console.log('❌ Element not found in refs')
      }
    }
  }, [selectedObjectId, isMinimized])

  const handleEditClick = (obj: DetectedObject) => {
    setEditingObjectId(obj.id)
    setEditingClass(obj.properties.class)
  }

  const handleSaveEdit = () => {
    if (editingObjectId && editingClass.trim()) {
      onUpdateObject(editingObjectId, editingClass.trim())
      setEditingObjectId(null)
      setEditingClass('')
    }
  }

  const handleCancelEdit = () => {
    setEditingObjectId(null)
    setEditingClass('')
  }

  return (
    <div className={`object-list-panel ${isMinimized ? 'minimized' : ''}`}>
      <div className="panel-header">
        <h2>对象列表 ({objects.length})</h2>
        <div className="header-buttons">
          <button
            className="minimize-btn"
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? "展开" : "最小化"}
          >
            {isMinimized ? (
              <ChevronDownIcon className="icon" />
            ) : (
              <ChevronUpIcon className="icon" />
            )}
          </button>
          <button
            className={`add-object-btn ${isAddMode ? 'active' : ''}`}
            onClick={onAddObject}
            title={isAddMode ? "退出添加模式" : "添加对象"}
          >
            {isAddMode ? (
              <>
                <CheckCircleIcon className="icon" />
                <span>添加中</span>
              </>
            ) : (
              <>
                <PlusCircleIcon className="icon" />
                <span>添加</span>
              </>
            )}
          </button>
          <button
            className="export-btn"
            onClick={onExportShapefile}
            disabled={objects.length === 0}
            title="导出为 Shapefile"
          >
            <ArchiveBoxIcon className="icon" />
            <span>导出</span>
          </button>
        </div>
      </div>

      {!isMinimized && (objects.length === 0 ? (
        <p className="empty-state">暂无检测到的对象</p>
      ) : (
        <div className="object-list-scroll">
          {objects.map((obj, index) => (
            <div
              key={obj.id}
              ref={(el) => {
                if (el) {
                  objectRefs.current.set(obj.id, el)
                } else {
                  objectRefs.current.delete(obj.id)
                }
              }}
              className={`object-item ${selectedObjectId === obj.id ? 'selected' : ''}`}
              onClick={() => onSelectObject(obj.id)}
            >
              {/* Thumbnail */}
              {obj.properties.thumbnail ? (
                <img
                  src={`data:image/png;base64,${obj.properties.thumbnail}`}
                  alt={`Object ${index + 1}`}
                  className="object-thumbnail"
                />
              ) : (
                <div className="object-thumbnail-placeholder">
                  <span>?</span>
                </div>
              )}

              {/* Object Info */}
              <div className="object-info">
                <div className="object-title">
                  <span
                    className="color-dot"
                    style={{ backgroundColor: getColorForClass(obj.properties.class) }}
                  ></span>
                  <span className="object-name">Object {index + 1}</span>
                </div>
                <div className="object-meta">
                  <span className="object-class">{obj.properties.class}</span>
                  <span className="object-confidence">
                    {(obj.properties.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="object-actions">
                {obj.properties.segmentation_mode === 'manual' && (
                  <button
                    className="edit-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleEditClick(obj)
                    }}
                    title="编辑类型"
                  >
                    <PencilSquareIcon className="action-icon" />
                  </button>
                )}
                <button
                  className="delete-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteObject(obj.id)
                  }}
                  title="删除对象"
                >
                  <TrashIcon className="action-icon" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Edit Dialog */}
      {editingObjectId && (
        <div className="edit-dialog-overlay" onClick={handleCancelEdit}>
          <div className="edit-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>编辑对象类型</h3>
            <input
              type="text"
              className="edit-input"
              value={editingClass}
              onChange={(e) => setEditingClass(e.target.value)}
              placeholder="输入新的类型 (如: buildings, trees)"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveEdit()
                } else if (e.key === 'Escape') {
                  handleCancelEdit()
                }
              }}
            />
            <div className="edit-dialog-buttons">
              <button className="edit-save-btn" onClick={handleSaveEdit}>
                保存
              </button>
              <button className="edit-cancel-btn" onClick={handleCancelEdit}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ObjectList
