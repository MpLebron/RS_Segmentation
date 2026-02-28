# GuZhu - AI Image Segmentation Platform

一个基于 SAM / SAM3 的智能影像分割平台，具有交互式地图界面，并提供语音助手作为可选交互方式（不替代常规界面操作流程）。

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

- 🗺️ 交互式 Mapbox 地图界面（支持 GeoTIFF 叠加）
- 📝 文本提示分割（SAM3，适合批量识别同类对象）
- 🎯 手动点选添加对象（SAM1，适合补提/修正）
- 📍 地理坐标与像素坐标转换（输出 GeoJSON）
- 📦 Shapefile 导出（ZIP）
- 🎙️ 语音助手（可选交互入口，可执行定位/缩放/分割/导出）

## 快速开始

### 1. 前端设置

```bash
cd frontend

# 安装依赖
npm install

# 配置环境变量（Mapbox Token 必需）
cat > .env <<EOF
VITE_MAPBOX_TOKEN=your_mapbox_token_here
EOF

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

# （可选）语音助手需要 OpenAI API Key
# 如果不使用语音功能，可以跳过
# export OPENAI_API_KEY=your_openai_api_key

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

2. **导入影像（推荐）**
   - 在右侧控制面板上传 GeoTIFF（也可直接使用底图进行识别）

3. **文本分割（主流程）**
   - 在右侧输入英文提示词（如 `buildings`、`roads`、`trees`）
   - 点击“开始分割”
   - 分割结果会以多边形叠加显示，并进入对象列表

4. **手动补提对象（可选）**
   - 在对象列表点击“添加”
   - 在地图上点击目标位置，系统会用点提示分割提取单个对象

5. **检查与导出**
   - 在对象列表中选择/删除/编辑对象类型
   - 点击“导出”生成 Shapefile ZIP

6. **语音助手（可选，不替代以上流程）**
   - 语音按钮可辅助执行定位、缩放、触发分割和导出
   - 常规鼠标/面板操作仍是完整主流程，语音只是另一种入口

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

- `GET /health`：健康检查
- `GET /api/model-info`：模型加载状态
- `POST /api/segment-text`：文本提示分割（SAM3）
- `POST /api/segment-single`：手动点选单对象分割（SAM1）
- `POST /api/segment-batch`：批量点选分割
- `POST /api/segment-auto`：自动分割（SAM3）
- `POST /api/upload-tiff`：上传 GeoTIFF 并转换为 PNG 叠加层
- `POST /api/export-shapefile`：导出 Shapefile ZIP
- `POST /api/realtime/session`：创建语音实时会话 token（可选功能）

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
   - 开发环境确认 Vite 代理配置生效（`/api` -> `localhost:8000`）

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

4. **语音助手连接失败**
   - 语音功能依赖 `OPENAI_API_KEY`
   - 不影响文本分割、手动添加对象和导出等常规功能

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request!

## 联系方式

项目地址: https://github.com/yourusername/GuZhu
