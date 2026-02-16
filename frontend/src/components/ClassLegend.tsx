import './ClassLegend.css'

interface ClassLegendProps {
  classes: string[]
}

// Color mapping for different classes
const CLASS_COLORS: { [key: string]: string } = {
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

function getColorForClass(className: string): string {
  return CLASS_COLORS[className.toLowerCase()] || '#FF00FF'
}

function ClassLegend({ classes }: ClassLegendProps) {
  if (classes.length === 0) {
    return null
  }

  // Get unique classes
  const uniqueClasses = Array.from(new Set(classes))

  return (
    <div className="class-legend">
      <div className="legend-header">
        <h3>图例</h3>
      </div>
      <div className="legend-items">
        {uniqueClasses.map(className => (
          <div key={className} className="legend-item">
            <div
              className="legend-color"
              style={{ backgroundColor: getColorForClass(className) }}
            />
            <span className="legend-label">{className}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ClassLegend
export { getColorForClass }
