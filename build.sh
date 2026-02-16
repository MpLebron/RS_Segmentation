#!/bin/bash
# ============================================
# GuZhu 本地构建脚本
# 构建镜像并导出为 tar 文件
# ============================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
OUTPUT_DIR="$PROJECT_DIR/docker-images"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 默认使用 GPU 版本
MODE="gpu"

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --cpu)
            MODE="cpu"
            shift
            ;;
        --gpu)
            MODE="gpu"
            shift
            ;;
        -h|--help)
            echo "用法: $0 [--gpu|--cpu]"
            echo "  --gpu  构建 GPU 版本 (默认)"
            echo "  --cpu  构建 CPU 版本"
            exit 0
            ;;
        *)
            log_error "未知选项: $1"
            exit 1
            ;;
    esac
done

log_info "GuZhu 镜像构建脚本"
log_info "构建模式: $MODE"
echo ""

# 检查 Docker
if ! command -v docker &> /dev/null; then
    log_error "Docker 未安装!"
    exit 1
fi

# 创建输出目录
mkdir -p "$OUTPUT_DIR"

# 检查 .env 文件
if [ ! -f "$PROJECT_DIR/.env" ]; then
    log_error ".env 文件不存在，请先创建"
    exit 1
fi

source "$PROJECT_DIR/.env"

# ===== 构建前端镜像 =====
log_info "构建前端镜像..."
cd "$PROJECT_DIR/frontend"

docker build \
    --build-arg VITE_MAPBOX_TOKEN="$VITE_MAPBOX_TOKEN" \
    --build-arg VITE_API_BASE_URL="/api" \
    -t guzhu-frontend:latest \
    -f Dockerfile .

log_success "前端镜像构建完成"

# ===== 构建后端镜像 =====
log_info "构建后端镜像 ($MODE 模式)..."
cd "$PROJECT_DIR/backend"

if [ "$MODE" = "gpu" ]; then
    docker build \
        -t guzhu-backend:latest \
        -f Dockerfile .
else
    docker build \
        -t guzhu-backend:latest \
        -f Dockerfile.cpu .
fi

log_success "后端镜像构建完成"

# ===== 导出镜像为 tar 文件 =====
log_info "导出镜像为 tar 文件..."
cd "$PROJECT_DIR"

# 导出前端镜像
log_info "导出 guzhu-frontend..."
docker save guzhu-frontend:latest | gzip > "$OUTPUT_DIR/guzhu-frontend.tar.gz"

# 导出后端镜像
log_info "导出 guzhu-backend..."
docker save guzhu-backend:latest | gzip > "$OUTPUT_DIR/guzhu-backend.tar.gz"

# ===== 复制部署文件 =====
log_info "复制部署文件..."

# 创建部署包目录
DEPLOY_DIR="$OUTPUT_DIR/deploy"
mkdir -p "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR/models/checkpoints"

# 复制必要文件 (使用服务器版本的 docker-compose)
cp "$PROJECT_DIR/.env" "$DEPLOY_DIR/"
cp "$PROJECT_DIR/docker-compose.server.yml" "$DEPLOY_DIR/docker-compose.yml"
cp "$PROJECT_DIR/docker-compose.gpu.yml" "$DEPLOY_DIR/"
cp "$PROJECT_DIR/docker-compose.cpu.yml" "$DEPLOY_DIR/"

# 复制 SAM 模型文件 (如果存在)
if [ -f "$PROJECT_DIR/backend/models/checkpoints/sam_vit_h.pth" ]; then
    log_info "复制 SAM 模型文件 (2.4GB)..."
    cp "$PROJECT_DIR/backend/models/checkpoints/sam_vit_h.pth" "$DEPLOY_DIR/models/checkpoints/"
else
    log_warning "SAM1 模型文件不存在，跳过"
fi

# 创建服务器部署脚本
cat > "$DEPLOY_DIR/start.sh" << 'EOF'
#!/bin/bash
# GuZhu 服务器启动脚本

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODE="gpu"
ACTION="up"

while [[ $# -gt 0 ]]; do
    case $1 in
        --cpu) MODE="cpu"; shift ;;
        --gpu) MODE="gpu"; shift ;;
        up|down|restart|logs|status) ACTION="$1"; shift ;;
        *) shift ;;
    esac
done

get_compose_cmd() {
    if [ "$MODE" = "gpu" ]; then
        echo "docker compose -f docker-compose.yml -f docker-compose.gpu.yml"
    else
        echo "docker compose -f docker-compose.yml -f docker-compose.cpu.yml"
    fi
}

case $ACTION in
    up)
        log_info "启动服务 (模式: $MODE)..."
        $(get_compose_cmd) up -d
        log_success "服务已启动!"
        echo "访问地址: http://$(hostname -I | awk '{print $1}')"
        ;;
    down)
        log_info "停止服务..."
        $(get_compose_cmd) down
        log_success "服务已停止"
        ;;
    restart)
        $(get_compose_cmd) down
        $(get_compose_cmd) up -d
        log_success "服务已重启"
        ;;
    logs)
        $(get_compose_cmd) logs -f
        ;;
    status)
        $(get_compose_cmd) ps
        ;;
esac
EOF

chmod +x "$DEPLOY_DIR/start.sh"

# ===== 显示结果 =====
echo ""
log_success "=========================================="
log_success "构建完成!"
log_success "=========================================="
echo ""
log_info "输出文件:"
ls -lh "$OUTPUT_DIR"/*.tar.gz
echo ""
log_info "部署包目录: $DEPLOY_DIR"
ls -la "$DEPLOY_DIR"
echo ""

# 计算总大小
TOTAL_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)
log_info "总大小: $TOTAL_SIZE"
echo ""

log_info "下一步操作:"
echo "  1. 上传文件到服务器:"
echo "     scp -r $OUTPUT_DIR root@47.85.81.161:/opt/guzhu"
echo ""
echo "  2. 在服务器上加载镜像并启动:"
echo "     ssh root@47.85.81.161"
echo "     cd /opt/guzhu"
echo "     gunzip -c guzhu-frontend.tar.gz | docker load"
echo "     gunzip -c guzhu-backend.tar.gz | docker load"
echo "     cd deploy"
echo "     ./start.sh --gpu up"
echo ""
