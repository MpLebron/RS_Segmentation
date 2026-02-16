import React from 'react'
import './PendingQueue.css'

interface PendingRequest {
  id: string
  timestamp: number
  status: 'processing' | 'complete'
}

interface PendingQueueProps {
  requests: PendingRequest[]
}

const PendingQueue: React.FC<PendingQueueProps> = ({ requests }) => {
  if (requests.length === 0) return null

  return (
    <div className="pending-queue">
      {requests.map(request => (
        <div key={request.id} className="pending-queue-item">
          <div className="queue-spinner"></div>
          <span>正在提取对象...</span>
        </div>
      ))}
    </div>
  )
}

export default PendingQueue
