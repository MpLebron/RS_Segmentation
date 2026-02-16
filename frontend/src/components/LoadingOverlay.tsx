import React from 'react'
import './LoadingOverlay.css'

interface LoadingOverlayProps {
  isVisible: boolean
  message?: string
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  isVisible,
  message = "正在处理，请稍候..."
}) => {
  if (!isVisible) return null

  return (
    <div className="loading-overlay">
      <div className="loading-overlay-content">
        <div className="loading-spinner"></div>
        <p className="loading-message">{message}</p>
      </div>
    </div>
  )
}

export default LoadingOverlay
