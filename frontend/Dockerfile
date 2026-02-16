# ============================================
# GuZhu Frontend Dockerfile
# 多阶段构建: Node.js 构建 + Nginx 服务
# ============================================

# Stage 1: 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装依赖
RUN npm ci

# 复制源代码
COPY . .

# 构建参数 (构建时使用)
ARG VITE_MAPBOX_TOKEN
ARG VITE_API_BASE_URL=/api

# 设置环境变量
ENV VITE_MAPBOX_TOKEN=${VITE_MAPBOX_TOKEN}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# 构建应用
RUN npm run build

# Stage 2: 生产阶段
FROM nginx:alpine

# 复制自定义 nginx 配置
COPY nginx.conf /etc/nginx/nginx.conf

# 删除默认配置（避免冲突）
RUN rm -f /etc/nginx/conf.d/default.conf

# 从构建阶段复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

# 暴露端口
EXPOSE 80

# 启动 Nginx
CMD ["nginx", "-g", "daemon off;"]
