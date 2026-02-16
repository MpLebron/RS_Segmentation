# SAM3 配置说明

## 概述

GuZhu 现已集成 **Meta SAM3（Segment Anything Model 3）** 的文本分割和自动分割功能！

我们使用 **Hugging Face Inference API** 方式，无需复杂的本地部署（避免了 triton 在 macOS ARM 上的兼容性问题）。

## ✅ 已完成配置

### 1. Hugging Face 认证

- ✅ 已获得 SAM3 模型访问权限
- ✅ HF Token 已配置到 `.env` 文件
- ✅ Token 自动从环境变量加载

**配置文件位置**: `backend/.env`

```env
HUGGINGFACE_TOKEN=your_huggingface_token_here
SAM_MODEL_VERSION=sam3
```

### 2. 后端实现

- ✅ 创建了 `sam3_hf_api.py` - HF API 客户端
- ✅ 更新了 `main.py` - 自动选择 HF API 作为 SAM3 后端
- ✅ 支持文本分割 (`/api/segment-text`)
- ✅ 支持自动分割 (`/api/segment-auto`)

### 3. 前端界面

前端已有完整的 UI 支持：
- 三种分割模式：点击分割、文本分割、自动分割
- ClassLegend 组件显示分割类别
- 彩色 GeoJSON 渲染不同类别

## 🚀 使用方法

### 启动服务

```bash
# 后端
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000

# 前端
cd frontend
npm run dev
```

### 在浏览器中使用

1. 打开 http://localhost:3000
2. 上传图片
3. 选择分割模式：
   - **点击分割**: 传统 SAM 1.0 点击方式（无需网络）
   - **文本分割**: 输入文本描述，如 "buildings", "trees", "cars" 等
   - **自动分割**: 自动识别所有对象
4. 点击"开始分割"
5. 查看结果：地图上显示彩色分割区域，右侧图例显示类别

## 🔧 技术架构

### SAM3 集成方式对比

| 方式 | 优点 | 缺点 | 状态 |
|------|------|------|------|
| **HF Inference API** (当前使用) | ✅ 无需本地依赖<br>✅ 自动更新模型<br>✅ macOS ARM 兼容 | ❌ 需要网络<br>❌ API 限流 | ✅ 已实现 |
| 本地 SAM3 部署 | ✅ 离线可用<br>✅ 无限制 | ❌ 依赖复杂（triton）<br>❌ macOS ARM 不兼容 | ❌ 不可用 |

### 代码结构

```
backend/
├── models/
│   ├── sam_model.py          # SAM 1.0 (点击分割)
│   ├── sam3_hf_api.py         # SAM3 HF API 客户端 ⭐ 新增
│   ├── sam3_model.py          # SAM3 本地部署（备用）
│   └── coordinate_converter.py # 坐标转换
├── app/
│   └── main.py               # FastAPI 路由（已更新）
└── .env                      # 环境变量（包含 HF Token）
```

## 📝 API 端点

### 1. 文本分割
```http
POST /api/segment-text
Content-Type: multipart/form-data

file: <image_file>
text_prompt: "buildings"
bounds: '{"west": -122.5, "south": 37.7, "east": -122.3, "north": 37.9}'
```

### 2. 自动分割
```http
POST /api/segment-auto
Content-Type: multipart/form-data

file: <image_file>
bounds: '{"west": -122.5, "south": 37.7, "east": -122.3, "north": 37.9}'
```

### 3. 健康检查
```http
GET /health

Response:
{
  "status": "healthy",
  "sam_loaded": false,
  "sam3_available": true
}
```

## ⚠️ 注意事项

### Hugging Face API 限制

1. **速率限制**: 免费账户有请求速率限制
2. **模型加载时间**: 首次请求可能需要等待模型加载（~20-30秒）
3. **图片大小**: 建议不超过 5MB

### 网络要求

- 文本/自动分割需要网络连接 Hugging Face
- 点击分割使用本地 SAM 1.0，无需网络

### Token 安全

- ⚠️ **不要** 将 `.env` 文件提交到 Git
- Token 具有 Read 权限，安全性较高
- 如需撤销，访问 https://huggingface.co/settings/tokens

## 🐛 故障排除

### 1. "SAM3 not available" 错误

检查：
```bash
cd backend
source venv/bin/activate
python -c "from models.sam3_hf_api import get_sam3_hf_instance; print('OK')"
```

### 2. "Unauthorized" 错误

检查 Token 配置：
```bash
cat backend/.env | grep HUGGINGFACE_TOKEN
```

### 3. API 请求超时

- 检查网络连接
- 尝试点击分割模式（本地 SAM 1.0）
- 等待 HF 模型加载完成后重试

## 📚 参考资料

- [SAM3 Hugging Face](https://huggingface.co/facebook/sam3)
- [SAM3 GitHub](https://github.com/facebookresearch/sam3)
- [Hugging Face Inference API 文档](https://huggingface.co/docs/api-inference/index)
- [Transformers SAM3 文档](https://huggingface.co/docs/transformers/model_doc/sam3)

## 🎉 总结

SAM3 已成功集成！现在你可以：

1. ✅ 使用文本描述分割图像（"找出所有建筑"）
2. ✅ 自动分割图像中的所有对象
3. ✅ 在地图上可视化分割结果
4. ✅ 导出为 GeoJSON 格式

**下一步**: 在浏览器中尝试文本分割功能！🚀
