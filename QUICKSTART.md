# 快速启动指南

## 第一次运行（安装配置）

### 1. 前端配置 (5分钟)

```bash
# 进入前端目录
cd frontend

# 安装依赖
npm install

# 配置Mapbox Token
echo "VITE_MAPBOX_TOKEN=your_token_here" > .env

# 获取token: https://account.mapbox.com/
```

### 2. 后端配置 (10-30分钟，取决于下载速度)

```bash
# 进入后端目录
cd backend

# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
source venv/bin/activate  # macOS/Linux
# 或 venv\Scripts\activate  # Windows

# 安装依赖
pip install -r requirements.txt

# 创建模型目录
mkdir -p models/checkpoints

# 下载SAM模型 (约2.4GB)
# 方式1: 使用wget
wget -P models/checkpoints/ https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth

# 方式2: 使用curl
curl -o models/checkpoints/sam_vit_h_4b8939.pth https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth

# 方式3: 手动下载
# 访问 https://github.com/facebookresearch/segment-anything#model-checkpoints
# 下载后放到 models/checkpoints/sam_vit_h.pth
```

## 日常启动（已配置完成后）

### 终端1 - 启动后端

```bash
cd backend
source venv/bin/activate  # Windows: venv\Scripts\activate
uvicorn app.main:app --reload --port 8000
```

看到以下输出表示成功:
```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

### 终端2 - 启动前端

```bash
cd frontend
npm run dev
```

看到以下输出表示成功:
```
  VITE v5.0.8  ready in XXX ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

### 3. 访问应用

打开浏览器访问: http://localhost:3000

## 使用流程

1. **上传影像** - 点击右侧面板的文件选择按钮
2. **选择点位** - 在地图上点击要分割的区域
3. **执行分割** - 点击"开始分割"按钮
4. **查看结果** - 分割结果会以红色多边形显示在地图上

## 验证安装

### 检查后端
```bash
curl http://localhost:8000/health
# 应返回: {"status":"healthy","sam_loaded":false}
```

### 检查前端
打开浏览器开发者工具，查看是否有错误

## 常见问题

### Q1: Mapbox地图不显示
**A:** 检查 `.env` 文件中的 `VITE_MAPBOX_TOKEN` 是否正确设置

### Q2: 后端启动失败 - 找不到模块
**A:** 确保虚拟环境已激活，重新运行 `pip install -r requirements.txt`

### Q3: SAM模型加载失败
**A:** 检查模型文件是否存在于 `backend/models/checkpoints/sam_vit_h.pth`

### Q4: 前端无法连接后端
**A:** 确保后端运行在 http://localhost:8000，检查防火墙设置

### Q5: 内存不足
**A:** 尝试使用较小的模型:
- ViT-B (375MB): https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
- 将文件重命名为 `sam_vit_b.pth`，并在代码中修改 `model_type="vit_b"`

## 文件结构速查

```
GuZhu/
├── frontend/              # 前端应用
│   ├── src/
│   │   ├── App.tsx       # 主组件
│   │   ├── components/   # UI组件
│   │   └── services/     # API调用
│   ├── .env              # Mapbox配置 (需创建)
│   └── package.json
│
├── backend/              # 后端服务
│   ├── app/main.py       # API端点
│   ├── models/           # AI模型和工具
│   │   ├── sam_model.py
│   │   └── coordinate_converter.py
│   ├── models/checkpoints/  # 模型文件 (需下载)
│   └── requirements.txt
│
└── README.md             # 详细文档
```

## 端口占用问题

如果默认端口被占用，可以修改:

**后端 (默认8000):**
```bash
uvicorn app.main:app --reload --port 8001
```

**前端 (默认3000):**
修改 `vite.config.ts`:
```typescript
server: {
  port: 3001,  // 改为其他端口
  ...
}
```

## 停止服务

在对应终端按 `Ctrl+C`

## 更新依赖

### 前端
```bash
cd frontend
npm update
```

### 后端
```bash
cd backend
source venv/bin/activate
pip install --upgrade -r requirements.txt
```

## 获取帮助

- 查看 `README.md` 了解详细文档
- 查看 `PROJECT_SUMMARY.md` 了解项目架构
- 访问 http://localhost:8000/docs 查看API文档
