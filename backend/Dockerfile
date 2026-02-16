# ============================================
# GuZhu Backend Dockerfile (GPU Version)
# 支持 NVIDIA CUDA GPU 加速
# ============================================

FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

# 设置环境变量
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    # PyTorch 缓存目录
    TORCH_HOME=/app/models/.cache/torch \
    # Hugging Face 缓存目录
    HF_HOME=/app/models/.cache/huggingface \
    TRANSFORMERS_CACHE=/app/models/.cache/huggingface \
    # SAM 模型配置
    SAM_MODEL_VERSION=sam3 \
    SAM_MODEL_TYPE=vit_h

# 使用阿里云镜像源加速
RUN sed -i 's/ports.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list && \
    sed -i 's/archive.ubuntu.com/mirrors.aliyun.com/g' /etc/apt/sources.list

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 \
    python3.10-dev \
    python3-pip \
    python3-venv \
    python3-gdal \
    libgdal-dev \
    gdal-bin \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    build-essential \
    wget \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && ln -sf /usr/bin/pip3 /usr/bin/pip

# 设置 GDAL 环境变量
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal \
    C_INCLUDE_PATH=/usr/include/gdal

# 创建工作目录
WORKDIR /app

# 创建非 root 用户（安全考虑）
RUN groupadd -r appuser && useradd -r -g appuser appuser

# 先复制 requirements.txt 以利用 Docker 缓存
COPY requirements.txt .

# 安装 Python 依赖
# 先安装 CUDA 版本的 PyTorch
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu118 && \
    pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY app/ ./app/
COPY models/*.py ./models/

# 创建必要的目录
RUN mkdir -p /app/models/checkpoints \
    /app/models/.cache/torch \
    /app/models/.cache/huggingface

# 设置目录权限
RUN chown -R appuser:appuser /app

# 切换到非 root 用户
USER appuser

# 暴露端口
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=30s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# 启动命令
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
