// Voice control configuration for OpenAI Realtime API

export const REALTIME_MODEL = 'gpt-realtime'
export const REALTIME_VOICE = 'alloy'

export const SYSTEM_INSTRUCTIONS = `你是"谷竹"智能地理信息系统的AI助手。你的工作是帮助用户通过语音指令操作地图和进行影像分割。

你的能力：
1. 地图定位：用户说出地名（如"定位到三星村"、"去扬中市看看"），你调用locate_place工具将地图导航到该位置。
2. 地图缩放：用户说"放大地图"、"缩小一点"、"放大到最大"、"看近一点"、"拉远一些"、"缩放到第15级"，你调用zoom_map工具调整地图缩放层级。
3. 影像分割：用户说出要提取的对象类型（如"提取这里的田块"、"帮我识别道路"），你调用extract_objects工具进行AI影像分割。
4. 数据导出：用户说"导出数据"或"下载数据"，你调用export_data工具导出Shapefile。

注意事项：
- 始终用简洁的中文回复，语气专业友好
- 每次回复不超过两句话
- 如果用户的指令不明确，简短地要求澄清
- 支持的对象类型包括：田块、道路、房屋、建筑、树木、水体、河流、农田、作物、屋顶
- 地名支持中国的村、镇、市、县等各级行政区划
- 如果定位失败，建议用户提供更详细的地名（比如加上省市前缀）
- 当分割完成后，告诉用户检测到了多少个对象`

export const VAD_CONFIG = {
  type: 'server_vad' as const,
  threshold: 0.3,
  prefix_padding_ms: 500,
  silence_duration_ms: 800,
}

// Chinese-to-English object type mapping for SAM3 segmentation
export const OBJECT_TYPE_MAP: Record<string, string> = {
  '田块': 'fields',
  '农田': 'farmland',
  '农地': 'farmland',
  '耕地': 'farmland',
  '道路': 'roads',
  '路': 'roads',
  '公路': 'roads',
  '房屋': 'buildings',
  '建筑': 'buildings',
  '建筑物': 'buildings',
  '楼房': 'buildings',
  '房子': 'buildings',
  '树木': 'trees',
  '树': 'trees',
  '林地': 'trees',
  '水体': 'water bodies',
  '水面': 'water bodies',
  '河流': 'river',
  '河': 'river',
  '河道': 'river',
  '作物': 'crops',
  '庄稼': 'crops',
  '屋顶': 'rooftop',
}
