import React, { useState } from 'react'
import { ArrowUpTrayIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { uploadTiff } from '../services/api'
import './TiffUploader.css'

interface TiffUploaderProps {
  onTiffUploaded: (imageUrl: string, bounds: { west: number, south: number, east: number, north: number }) => void
}

const TiffUploader: React.FC<TiffUploaderProps> = ({ onTiffUploaded }) => {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.tif') && !file.name.toLowerCase().endsWith('.tiff')) {
      setError('请选择 TIFF 或 GeoTIFF 文件')
      return
    }

    setUploading(true)
    setError(null)

    try {
      const result = await uploadTiff(file)

      if (result.success) {
        // Convert base64 to data URL
        const imageUrl = `data:image/png;base64,${result.image}`
        onTiffUploaded(imageUrl, result.bounds)
      } else {
        throw new Error('处理 TIFF 文件失败')
      }
    } catch (err) {
      console.error('TIFF upload error:', err)
      setError('上传失败: ' + (err as Error).message)
    } finally {
      setUploading(false)
      // Reset input
      event.target.value = ''
    }
  }

  return (
    <div className="tiff-uploader">
      <label className="tiff-upload-btn" title="导入 GeoTIFF 影像">
        <input
          type="file"
          accept=".tif,.tiff"
          onChange={handleFileChange}
          disabled={uploading}
          style={{ display: 'none' }}
        />
        {uploading ? (
          <>
            <ArrowPathIcon className="icon spinning" />
            <span>上传中...</span>
          </>
        ) : (
          <>
            <ArrowUpTrayIcon className="icon" />
            <span>导入 TIFF</span>
          </>
        )}
      </label>
      {error && <div className="tiff-error">{error}</div>}
    </div>
  )
}

export default TiffUploader
