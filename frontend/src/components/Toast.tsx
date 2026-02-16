import React, { useState, useEffect } from 'react'
import './Toast.css'

interface ToastProps {
  message: string
  duration?: number  // 默认 2000ms
  onDismiss: () => void
}

const Toast: React.FC<ToastProps> = ({
  message,
  duration = 2000,
  onDismiss
}) => {
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    // 显示指定时长后开始退出动画
    const timer = setTimeout(() => {
      setIsExiting(true)

      // 退出动画完成后调用 onDismiss
      setTimeout(() => {
        onDismiss()
      }, 300)  // 与 CSS fadeOut 动画时长匹配
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, onDismiss])

  return (
    <div className={`toast ${isExiting ? 'exiting' : ''}`}>
      <div className="toast-spinner"></div>
      <p>{message}</p>
    </div>
  )
}

export default Toast
