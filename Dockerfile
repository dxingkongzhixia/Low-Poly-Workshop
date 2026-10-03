# 低模工坊 —— 零依赖（只用 Node 内置模块），没有 npm install / 构建步骤
FROM node:20-alpine

WORKDIR /app
COPY . .

# 容器里必须绑 0.0.0.0 才能把端口映射出去；鉴权用环境变量开
ENV PORT=8765 \
    HOST=0.0.0.0

# 产物目录（挂卷就用卷，不挂也能写）
RUN mkdir -p NewlyAddedModelList NewlyAddedModelTemporaryList \
             NewlyAddedWeaponList NewlyAddedWeaponTemporaryList \
             OriginalWeaponList TemporaryCache TemporaryCache/refs data

EXPOSE 8765
CMD ["node", "tools/_serve.js"]
