# Books

`Books` 是基于 `koodo-reader` 改造的中心化书库服务，保留原本优秀的网页阅读体验，同时把书籍、封面、书签、笔记、阅读进度和部分管理能力统一收敛到服务端。

当前仓库面向自托管场景，适合家庭书库、小团队内部书库，或者替代单机版 Koodo Web 的集中部署。

## 当前能力

- 服务端统一存储书籍、封面和书库配置
- Web 端登录后访问书库
- 管理员上传书籍、维护账户、分配书籍可见范围
- 书籍详情弹窗，支持封面、简介、下载、阅读、笔记切换
- 内置书籍元信息获取接口
- 支持 OPDS
- 支持明暗主题切换

## 目录与数据

运行时数据默认存放在挂载目录 `/app/uploads`，当前项目默认使用本地目录：

```text
./data/uploads
├── book/
├── cover/
└── config/
```

其中：

- `book/`：电子书文件
- `cover/`：封面文件
- `config/`：书库配置、笔记、阅读进度及元数据数据库

## 本地开发

安装依赖：

```bash
corepack enable
pnpm install
```

启动前端开发服务：

```bash
pnpm start
```

单独启动 Go 服务：

```bash
cd httpserver
STATIC_DIR=../build ENABLE_HTTP_SERVER=true ENABLE_LIBRARY_SERVER=true ENABLE_OPDS=true PORT=8080 go run .
```

构建产物：

```bash
pnpm build
cd httpserver
go build ./...
```

## 容器构建

### 方式一：直接使用 Dockerfile

适合本机已经具备基础镜像缓存的场景：

```bash
docker build -t koodo-centralized:local .
```

### 方式二：宿主机本地打包后构建运行镜像

适合 Docker Hub 拉取不稳定时使用，不依赖在 Docker build 阶段拉取 `node`、`golang`、`caddy`：

```bash
chmod +x scripts/package-local-image.sh
./scripts/package-local-image.sh
```

默认镜像名：

```text
koodo-centralized:local
```

## 运行容器

当前部署建议与现网保持一致：

```bash
mkdir -p /vol1/data/Books/data/uploads

docker run -d \
  --name koodo-centralized \
  -p 18083:8080 \
  -e SERVER_USERNAME=admin \
  -e SERVER_PASSWORD='ChangeMe_2026!' \
  -e ENABLE_HTTP_SERVER=true \
  -e ENABLE_LIBRARY_SERVER=true \
  -e ENABLE_OPDS=true \
  -e STATIC_DIR=/app/build \
  -e PORT=8080 \
  -v /vol1/data/Books/data/uploads:/app/uploads \
  --log-opt max-size=100m \
  --log-opt max-file=5 \
  koodo-centralized:local
```

访问地址：

- 书库地址：`http://<服务器IP>:18083`
- OPDS：`http://<服务器IP>:18083/opds`

## Docker Compose

仓库内的 `docker-compose.yml` 已按当前部署方式调整，可直接使用：

```bash
docker compose up --build -d
```

默认映射：

- 宿主机端口：`18083`
- 数据目录：`/vol1/data/Books/data/uploads`

## 内置元信息能力

当前元信息查询已经内置到 `Books` 服务中，不再依赖外部 `douban-api-rs` 容器。

接口：

- `GET /api/library/metadata?name=书名&author=作者`
- `GET /api/library/metadata?source=Douban&key=条目ID`
- `GET /api/library/metadata?isbn=ISBN`

前端书籍详情页的“豆瓣”按钮会直接调用本服务接口。

## 书库维护

### 重复书籍去重

当前书库支持按“书名 + 作者”归一化后进行重复书籍清理，现行规则：

- 优先保留 `MOBI`
- 没有 `MOBI` 时，保留元信息更完整的记录
- 删除重复记录对应的书籍文件、封面文件，以及关联的权限/笔记/书签/阅读位置记录

执行去重前建议先备份：

```bash
mkdir -p /vol1/data/Books/data/backups
cp /vol1/data/Books/data/uploads/config/books.db /vol1/data/Books/data/backups/books.db.$(date +%Y%m%d-%H%M%S)
cp /vol1/data/Books/data/uploads/config/library.db /vol1/data/Books/data/backups/library.db.$(date +%Y%m%d-%H%M%S)
```

去重完成后，建议重建容器并重新加载书库页面，确保前端与去重后的 `books.db` 保持一致。

## 关键文件

- `httpserver/main.go`：HTTP 服务入口
- `httpserver/library.go`：中心化书库接口
- `httpserver/douban.go`：内置元信息抓取
- `src/utils/storage/serverLibrary.ts`：前端服务端书库桥接
- `src/utils/storage/serverConfigSync.ts`：服务端配置同步
- `Dockerfile`：标准镜像构建
- `scripts/package-local-image.sh`：本地离线打包脚本

## 说明

- 当前仓库已经明显偏离上游 `koodo-reader` 的原始产品定位，后续应把它视为独立的 `Books` 服务维护。
- 如果要继续增强多用户隔离、批量元数据治理、采集源管理，建议下一步把账户和图书权限模型继续从前端状态下沉到后端数据库。
