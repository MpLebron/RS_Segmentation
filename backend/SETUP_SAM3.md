# SAM3设置指南

本指南帮助你配置SAM3（Segment Anything Model 3）以启用文本提示分割和自动分割功能。

## 前置要求

- Python 3.10+
- 8GB+ RAM（推荐16GB）
- GPU（可选，但强烈推荐用于更好的性能）

## 步骤1: 获取Hugging Face Token

1. 访问 [https://huggingface.co/](https://huggingface.co/) 注册账号
2. 进入 [https://huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
3. 点击 "New token"
4. 名称随意（如"GuZhu SAM3"），权限选择 **Read**
5. 创建token后复制保存（只显示一次）

## 步骤2: 请求SAM3模型访问权限

**重要**: SAM3模型需要申请访问权限

1. 访问 [https://huggingface.co/facebook/sam3](https://huggingface.co/facebook/sam3)
2. 点击页面上的 "Request Access" 按钮
3. 填写申请表单（说明用途，如"Research/Development"）
4. 提交申请
5. **等待Meta批准**（通常几分钟到几小时，有时可能需要1-2天）

**注意**: 在获得批准前，模型无法下载。你会收到邮件通知。

## 步骤3: 配置环境变量

```bash
cd backend
cp .env.example .env
```

编辑 `.env` 文件，将 `your_token_here` 替换为你在步骤1获取的token：

```bash
HUGGINGFACE_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SAM_MODEL_VERSION=sam3
SAM_MODEL_TYPE=vit_h
```

## 步骤4: 安装Python依赖

**确保虚拟环境已激活**:

```bash
# macOS/Linux:
source venv/bin/activate

# Windows:
# venv\Scripts\activate
```

**安装依赖**:

```bash
pip install -r requirements.txt
```

这将安装 `segment-geospatial[samgeo3]` 及所有依赖，包括：
- PyTorch
- Hugging Face transformers
- SAM3模型支持

**首次运行时**，samgeo会自动下载SAM3模型（约5GB），这可能需要几分钟。

## 步骤5: 验证安装

运行以下命令测试SAM3是否正确安装：

```bash
python -c "from samgeo import SamGeo3; print('✅ SAM3 ready!')"
```

如果看到 `✅ SAM3 ready!`，说明安装成功！

## 步骤6: 启动后端服务

```bash
uvicorn app.main:app --reload --port 8000
```

后端将运行在 http://localhost:8000

**首次启动提示**:
- 第一次加载SAM3模型可能需要10-30秒
- 后续启动会更快（模型已缓存）

## 常见问题

### Q1: "Access denied" 或 401错误
**A**: 检查以下几点：
- Hugging Face token是否正确配置在 `.env` 文件中
- 是否已获得SAM3模型访问权限（检查邮箱是否收到批准邮件）
- Token权限是否包含Read

### Q2: 模型下载很慢或失败
**A**:
- 检查网络连接
- 如果在中国大陆，可能需要配置代理或使用镜像
- 可以尝试手动下载模型并指定路径（见Q4）

### Q3: 内存不足错误
**A**: SAM3 ViT-H模型需要8GB+ RAM，尝试：
- 关闭其他程序释放内存
- 使用较小的模型：将 `.env` 中的 `SAM_MODEL_TYPE` 改为 `vit_l` 或 `vit_b`

### Q4: 如何使用本地模型文件？
**A**: 如果已下载模型文件，可以在代码中指定路径：

```python
sam = SamGeo3(checkpoint="/path/to/sam3_vit_h.pth")
```

### Q5: GPU未被识别
**A**:
```bash
# 检查CUDA是否可用
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"

# 如果输出False，需要重新安装支持CUDA的PyTorch
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

### Q6: 我可以同时使用SAM1和SAM3吗？
**A**: 可以！通过 `.env` 中的 `SAM_MODEL_VERSION` 切换：
- `SAM_MODEL_VERSION=sam1` - 使用原有SAM1（点提示分割）
- `SAM_MODEL_VERSION=sam3` - 使用SAM3（文本提示+自动分割）

## 卸载/回退到SAM1

如果遇到问题想回退到SAM1：

```bash
# 1. 修改 .env
SAM_MODEL_VERSION=sam1

# 2. 修改 requirements.txt
#    将 segment-geospatial[samgeo3] 改回:
torch==2.5.1
torchvision==0.20.1
segment-anything==1.0

# 3. 重新安装依赖
pip install -r requirements.txt
```

## 获取帮助

- SAM3官方文档: https://github.com/facebookresearch/sam3
- samgeo文档: https://samgeo.gishub.org/
- Hugging Face帮助: https://huggingface.co/docs

## 下一步

配置完成后，请参阅 `README.md` 了解如何使用文本提示分割和自动分割功能。
