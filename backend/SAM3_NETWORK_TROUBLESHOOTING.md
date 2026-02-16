# SAM3 网络问题解决方案

## ❌ 当前问题

遇到 SSL 错误：
```
HTTPSConnectionPool(host='api-inference.huggingface.co', port=443):
Max retries exceeded with url: /models/facebook/sam3
(Caused by SSLError(SSLError(5, '[SYS] unknown error (_ssl.c:2406)')))
```

这通常是由于：
- 网络防火墙阻止
- SSL证书验证问题
- 需要使用代理访问国际网站

## ✅ 解决方案

### 方案 1: 使用点击分割模式（推荐 ⭐）

**优点**: 完全本地运行，无需网络，立即可用

**步骤**:
1. 刷新浏览器页面
2. 选择 "**点击分割**" 模式
3. 上传图片
4. 在地图上点击要分割的对象（绿点=前景，红点=背景）
5. 点击"开始分割"

**说明**: 点击分割使用本地 SAM 1.0 模型，完全离线工作，不需要任何网络连接！

---

### 方案 2: 配置网络代理

如果你有科学上网工具（如 Clash, V2Ray 等），可以配置代理：

#### 步骤 1: 找到代理端口

通常是：
- HTTP 代理: `http://127.0.0.1:7890`
- HTTPS 代理: `http://127.0.0.1:7890`
- SOCKS5 代理: `socks5://127.0.0.1:7891`

#### 步骤 2: 配置 .env 文件

编辑 `backend/.env`:
```bash
# 取消注释并填入你的代理地址
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890
```

#### 步骤 3: 重启后端

```bash
# 停止当前后端 (Ctrl+C)
# 然后重新启动
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

---

### 方案 3: 使用系统代理

如果你的系统已经配置了全局代理，确保终端继承了代理设置：

```bash
# macOS/Linux
export HTTP_PROXY=http://127.0.0.1:7890
export HTTPS_PROXY=http://127.0.0.1:7890

# 然后重启后端
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

---

### 方案 4: 禁用 SSL 验证（不推荐，仅调试用）

⚠️ **不推荐用于生产环境**

如果只是为了测试，可以临时禁用 SSL 验证：

编辑 `backend/models/sam3_hf_api.py`，找到第 117 行：
```python
verify=True  # 改为 verify=False
```

**警告**: 这会降低安全性，仅用于调试！

---

## 🎯 推荐方案总结

| 方案 | 难度 | 需要网络 | 可用功能 |
|------|------|---------|---------|
| **点击分割** ⭐ | ✅ 简单 | ❌ 不需要 | SAM 1.0 点击分割 |
| 配置代理 | ⚠️ 中等 | ✅ 需要 | SAM3 文本/自动分割 |
| 系统代理 | ⚠️ 中等 | ✅ 需要 | SAM3 文本/自动分割 |

## 💡 建议

1. **立即可用**: 先使用 "点击分割" 模式体验功能
2. **如需文本分割**: 配置科学上网代理后使用 SAM3
3. **长期使用**: 考虑等待 SAM3 的本地部署方案（需要 Meta 解决 macOS ARM 兼容性问题）

## 📝 当前状态

- ✅ SAM 1.0 点击分割: 完全可用，无需网络
- ⚠️ SAM3 文本/自动分割: 需要网络访问 Hugging Face API
- ✅ 前端 UI: 完整支持三种模式
- ✅ 后端 API: 已部署并运行

## 🔍 验证连接

测试是否能访问 Hugging Face:

```bash
cd backend
source venv/bin/activate
python -c "
import requests
response = requests.get('https://huggingface.co', timeout=5)
print(f'状态: {response.status_code}')
print('✅ 可以访问 Hugging Face' if response.status_code == 200 else '❌ 无法访问')
"
```

如果显示 "❌ 无法访问"，则需要配置代理或使用点击分割模式。
