# 佳格图像分割智能体（RS_Segmentation）

一个面向遥感/GIS 场景的智能影像分割系统，基于 SAM / SAM3 提供文本分割、手动点选补提、GeoTIFF 叠加浏览、Shapefile 导出，以及语音助手这一种可选交互方式。

语音助手不是主流程替代品。完整工作流始终是：

1. 导入影像或使用底图
2. 文本提示分割
3. 手动添加对象补提/修正
4. 检查结果并导出

## 在线地址

- 在线访问：<https://sam-agent.gagogroup.cn>
- HTTPS 已启用，语音功能可直接在浏览器中申请麦克风权限

## 核心能力

- GeoTIFF 导入与地图叠加显示
- 基于 SAM3 的文本提示分割
- 基于 SAM1 的点选单对象补提
- 对象列表管理与缩略图预览
- GeoJSON 结果生成与 Shapefile ZIP 导出
- 语音助手辅助定位、缩放、触发分割和导出
- 语音链路走服务端中转，终端浏览器无需直连 OpenAI

## 典型使用流程

1. 在右侧面板导入 GeoTIFF，或直接使用底图
2. 输入英文提示词，例如 `buildings`、`roads`、`trees`、`farmland`
3. 点击“开始分割”，批量提取目标对象
4. 如有漏提，点击对象列表中的“添加”，在地图上点选补提单个对象
5. 在对象列表中检查、删除或调整对象类型
6. 点击“导出”生成 Shapefile ZIP
7. 如需更自然的交互，可使用语音助手辅助执行定位、缩放、分割和导出

## 项目结构

```text
GuZhu/
├── frontend/                  # React + TypeScript + Vite 前端
│   ├── src/
│   │   ├── components/        # UI 组件
│   │   ├── config/            # 语音与业务配置
│   │   ├── hooks/             # 地图、语音、业务逻辑
│   │   ├── services/          # API 请求
│   │   └── types/             # 前端类型定义
│   ├── nginx.conf             # 生产静态服务与 API/WebSocket 代理
│   └── Dockerfile
├── backend/                   # FastAPI + SAM/SAM3 后端
│   ├── app/
│   │   ├── main.py            # 主 API
│   │   └── realtime.py        # OpenAI Realtime 服务端中转
│   ├── models/                # SAM、SAM3 与坐标转换逻辑
│   ├── requirements.txt
│   └── Dockerfile
├── docker-compose.yml         # 基础 Compose 配置
├── docker-compose.server.yml  # 服务器部署配置
├── QUICKSTART.md              # 快速启动指南
└── README.md
```

## 技术栈

### 前端

- React 18
- TypeScript
- Vite
- Mapbox GL JS / react-map-gl
- 原生 Web Audio API

### 后端

- FastAPI
- PyTorch
- SAM / SAM3
- Pillow / OpenCV / Rasterio / GeoPandas
- OpenAI Realtime API（服务端 WebSocket relay）

## 运行要求

- Node.js >= 18
- Python >= 3.10
- 建议使用 CUDA GPU 运行 SAM / SAM3
- Mapbox Token（前端地图必需）
- Hugging Face Token（SAM3 模型下载/访问通常需要）
- OpenAI API Key（仅语音功能需要，可选）

## 本地开发

### 方式 A：前后端分别启动

#### 1. 前端

```bash
cd frontend
npm install

cat > .env <<'EOF'
VITE_MAPBOX_TOKEN=your_mapbox_token_here
EOF

npm run dev
```

默认访问地址：<http://localhost:3000>

#### 2. 后端

```bash
cd backend
python -m venv venv
source venv/bin/activate

pip install -r requirements.txt

# 仅语音功能需要
export OPENAI_API_KEY=your_openai_api_key

# SAM3 常见需要
export HUGGINGFACE_TOKEN=your_huggingface_token

mkdir -p models/checkpoints
wget -O models/checkpoints/sam_vit_h.pth \
  https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth

uvicorn app.main:app --reload --port 8000
```

默认访问地址：<http://localhost:8000>

API 文档：<http://localhost:8000/docs>

### 方式 B：Docker Compose

```bash
cp .env.example .env
```

编辑根目录 `.env`，至少补齐：

```bash
VITE_MAPBOX_TOKEN=your_mapbox_token_here
HUGGINGFACE_TOKEN=your_huggingface_token_here
OPENAI_API_KEY=your_openai_api_key
```

准备 SAM1 checkpoint：

```bash
mkdir -p backend/models/checkpoints
wget -O backend/models/checkpoints/sam_vit_h.pth \
  https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth
```

启动：

```bash
docker compose up --build
```

默认对外端口：

- 前端：<http://localhost>
- 后端健康检查：<http://localhost/health>

## 语音助手说明

- 语音助手是可选入口，不替代常规面板操作
- 当前实现已改为服务端中转模式：
  - 浏览器只连接你的站点
  - 后端再连接 OpenAI Realtime
- 这意味着终端用户本地不需要自己直连 OpenAI
- 但服务器本身仍然需要具备访问 OpenAI 的网络能力
- 浏览器仍需满足两个条件：
  - 页面运行在 HTTPS 或 localhost
  - 用户允许麦克风权限

## 分割模式说明

### 文本提示分割

- 主要用于批量识别同类目标
- 当前由 SAM3 负责
- 适合道路、建筑、树木、水体、田块等对象

### 手动点选补提

- 主要用于修正漏提目标
- 当前由 SAM1 负责
- 在 GPU 显存紧张时可自动回退到 CPU，以避免直接失败

## 主要 API

- `GET /health`：服务健康检查
- `GET /api/model-info`：模型状态
- `POST /api/upload-tiff`：上传 GeoTIFF
- `POST /api/segment-text`：文本分割（SAM3）
- `POST /api/segment-auto`：自动分割（SAM3）
- `POST /api/segment-single`：单点补提（SAM1）
- `POST /api/segment-batch`：批量点选分割
- `POST /api/export-shapefile`：导出 Shapefile ZIP
- `POST /api/realtime/session`：获取实时语音会话信息（兼容接口）
- `WS /api/realtime/ws`：语音实时 WebSocket relay

## 常见问题

### 1. 地图不显示

- 检查 `VITE_MAPBOX_TOKEN` 是否配置正确
- 检查 Token 是否有效、是否超出额度

### 2. 文本分割失败或返回为空

- 确认后端已正常加载 SAM3
- 确认 Hugging Face Token 可访问对应模型
- 尝试更稳定、通用的英文提示词

### 3. 点选补提失败

- 确认 `backend/models/checkpoints/sam_vit_h.pth` 存在
- 若服务器 GPU 显存不足，当前版本会自动回退到 CPU，速度会变慢但不应直接报错

### 4. 语音助手连接失败

- 确认后端已配置 `OPENAI_API_KEY`
- 确认服务器出网代理正常
- 确认当前站点是 HTTPS
- 确认浏览器已授权麦克风
- 语音失败不影响文本分割、手动补提和导出流程

### 5. 浏览器提示无法使用麦克风

- 检查当前页面是否为 HTTPS 或 localhost
- 检查浏览器站点权限中的麦克风是否被阻止
- 检查系统级麦克风权限

## 相关链接

- 在线系统：<https://sam-agent.gagogroup.cn>
- 快速启动：`QUICKSTART.md`
- 项目概览：`PROJECT_SUMMARY.md`

## License

MIT
