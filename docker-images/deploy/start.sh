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
