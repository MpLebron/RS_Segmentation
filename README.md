# GuZhu - AI Image Segmentation Platform

一个基于SAM (Segment Anything Model) 的智能影像分割平台，具有交互式地图界面。

## 项目结构

```
GuZhu/
├── frontend/          # React + TypeScript + Mapbox 前端
│   ├── src/
│   │   ├── components/
│   │   │   ├── MapView.tsx       # Mapbox地图组件
│   │   │   └── ControlPanel.tsx  # 控制面板组件
│   │   ├── services/
│   │   │   └── api.ts            # API服务
│   │   ├── styles/               # 样式文件
│   │   └── types/                # TypeScript类型定义
│   └── package.json
│
├── backend/           # FastAPI 后端服务
│   ├── app/
│   │   └── main.py               # FastAPI应用主文件
│   ├── models/
│   │   ├── sam_model.py          # SAM模型集成
│   │   └── coordinate_converter.py # 坐标转换工具
│   └── requirements.txt
│
└── README.md
```

## 功能特性

- 🗺️ 交互式Mapbox地图界面
- 🎯 基于点击的智能影像分割（SAM模型）
- 🌙 深色主题UI
- 📍 地理坐标与像素坐标转换
- 📦 GeoJSON格式导出
- ⚡ 实时分割可视化

## 快速开始

### 1. 前端设置

```bash
cd frontend

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，添加你的 Mapbox Token:
# VITE_MAPBOX_TOKEN=your_mapbox_token_here

# 启动开发服务器
npm run dev
```

前端将运行在: http://localhost:3000

**获取Mapbox Token:**

1. 访问 https://www.mapbox.com/
2. 注册/登录账号
3. 在 https://account.mapbox.com/ 获取 Access Token

### 2. 后端设置

```bash
cd backend

# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
# macOS/Linux:
source venv/bin/activate
# Windows:
# venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 下载SAM模型
# 创建checkpoints目录
mkdir -p models/checkpoints

# 下载模型文件（选择一个）:
# ViT-H (推荐，最佳质量，2.4GB):
wget -P models/checkpoints/ https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth

# 或者 ViT-L (中等大小，1.2GB):
# wget -P models/checkpoints/ https://dl.fbaipublicfiles.com/segment_anything/sam_vit_l_0b3195.pth

# 或者 ViT-B (轻量级，375MB):
# wget -P models/checkpoints/ https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth

# 启动后端服务
uvicorn app.main:app --reload --port 8000
```

后端将运行在: http://localhost:8000

**API文档:** http://localhost:8000/docs

## 使用说明

1. **启动服务**
   - 在两个终端分别启动前端和后端服务

2. **上传影像**
   - 在右侧控制面板上传影像文件

3. **选择分割点**
   - 在地图上点击选择需要分割的区域

4. **执行分割**
   - 点击"开始分割"按钮
   - AI将基于选择的点进行智能分割
   - 分割结果将在地图上显示

5. **查看结果**
   - 分割区域会以红色多边形显示
   - 选择点会以绿色圆点显示

## 技术栈

### 前端

- **框架**: React 18 + TypeScript
- **构建工具**: Vite
- **地图**: Mapbox GL JS + react-map-gl
- **样式**: CSS (深色主题)

### 后端

- **框架**: FastAPI
- **AI模型**: Segment Anything Model (SAM)
- **深度学习**: PyTorch
- **图像处理**: OpenCV, Pillow
- **坐标转换**: PyProj

## API端点

### `POST /api/segment`

分割影像

**参数:**

- `file`: 影像文件 (multipart/form-data)
- `points`: JSON字符串，包含点坐标和标签
- `bounds`: (可选) JSON字符串，影像的地理边界

**返回:**

```json
{
  "success": true,
  "geojson": {
    "type": "FeatureCollection",
    "features": [...]
  }
}
```

### `GET /health`

健康检查

### `GET /api/model-info`

获取模型信息

## 环境要求

- **Node.js**: >= 18.0.0
- **Python**: >= 3.8
- **GPU**: CUDA兼容GPU（可选，用于加速推理）

## 开发

### 前端开发

```bash
cd frontend
npm run dev      # 开发模式
npm run build    # 生产构建
npm run preview  # 预览构建结果
```

### 后端开发

```bash
cd backend
# 确保虚拟环境已激活
uvicorn app.main:app --reload --port 8000
```

## 故障排除

### 前端问题

1. **Mapbox地图不显示**
   - 检查 `.env` 文件中的 `VITE_MAPBOX_TOKEN` 是否正确
   - 确认token有效且未超过使用限制

2. **无法连接后端**
   - 确认后端服务运行在 http://localhost:8000
   - 检查浏览器控制台的CORS错误

### 后端问题

1. **SAM模型加载失败**
   - 确认模型文件路径正确: `backend/models/checkpoints/sam_vit_h.pth`
   - 检查模型文件是否完整下载

2. **内存不足**
   - 尝试使用较小的模型 (ViT-B 或 ViT-L)
   - 减小输入影像尺寸

3. **CUDA错误**
   - 如果没有GPU，模型会自动使用CPU
   - 确保PyTorch版本与CUDA版本匹配

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request!

## 联系方式

项目地址: https://github.com/yourusername/GuZhu
