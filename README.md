# Books

`Books` 是基于 `koodo-reader` 改造的中心化书库服务，保留原本优秀的网页阅读体验，同时把书籍、封面、书签、笔记、阅读进度和部分管理能力统一收敛到服务端。

当前仓库面向自托管场景，适合家庭书库、小团队内部书库，或者替代单机版 Koodo Web 的集中部署。

## 当前能力

- 服务端统一存储书籍、封面和书库配置
- Web 端登录后访问书库
- 管理员上传书籍、维护账户、分配书籍可见范围
- 全部图书分页加载，默认按导入顺序倒序展示
- 顶部标签筛选，展示每个标签下的书籍数量
- 书籍详情弹窗，支持封面、简介、下载、阅读、笔记切换
- 内置豆瓣元信息获取接口，支持同步标题、作者、出版社、ISBN、简介、评分、标签和封面
- 豆瓣封面会下载并替换为本地封面文件，避免前端长期依赖豆瓣图片地址
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

适合本机已经具备基础镜像缓存，或者网络可以访问 Docker Hub/GHCR 的场景：

```bash
docker build -t koodo-centralized:local .
```

标准镜像会把 `douban-api-rs` 静态二进制复制进 Books 镜像，用于豆瓣图片代理兜底。运行时不需要再单独启动 `douban-api-rs` 容器。

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

### 方式三：直接拉取阿里云镜像

当前已推送预构建镜像到阿里云 ACR：

```bash
docker pull registry.cn-hangzhou.aliyuncs.com/qiang2024_docker/books:bd406af6
```

镜像信息：

- 镜像地址：`registry.cn-hangzhou.aliyuncs.com/qiang2024_docker/books:bd406af6`
- 对应代码提交：`bd406af6 Enhance centralized Books library`
- 远端 digest：`sha256:de361422a4bf23d2e2b188ef29d11ad6fea4b0af9c39bc80ed5e9d49c2bd31c3`
- 本地镜像 ID：`8cb672f5fc84`

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
  registry.cn-hangzhou.aliyuncs.com/qiang2024_docker/books:bd406af6
```

如果使用本地构建镜像，将最后一行替换为 `koodo-centralized:local`。

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
- 重启策略：`unless-stopped`

## 内置元信息能力

当前元信息查询已经内置到 `Books` 服务中，不再依赖外部 `douban-api-rs` 容器。

接口：

- `GET /api/library/metadata?name=书名&author=作者`
- `GET /api/library/metadata?source=Douban&key=条目ID`
- `GET /api/library/metadata?isbn=ISBN`

前端书籍详情页的“豆瓣”按钮会直接调用本服务接口。

保存豆瓣元信息时，如果返回了封面地址，后端会执行以下流程：

1. 优先直接下载远程封面。
2. 如果豆瓣图片服务对 Go 客户端返回反爬页面，自动拉起镜像内置的 `/app/douban-api-rs`，通过本地 `127.0.0.1:20050/proxy` 兜底下载图片。
3. 只有确认内容是真实图片后才写入 `/app/uploads/cover`。
4. 数据库中的 `cover` 字段会更新为本地封面文件名，例如 `1783768513065.jpg`。

可选环境变量：

- `DOUBAN_IMAGE_PROXY_URL`：覆盖默认代理地址，默认 `http://127.0.0.1:20050`
- `DOUBAN_IMAGE_PROXY_BINARY`：覆盖内置代理二进制路径，默认 `/app/douban-api-rs`

## 图书列表与标签

全部图书使用分页接口加载，避免一次性拉取全部书籍造成首页卡顿。

相关接口：

- `GET /api/library/books?page=1&pageSize=27`
- `GET /api/library/books?page=1&pageSize=27&tag=科幻`
- `GET /api/library/tags`

展示规则：

- 卡片模式默认每页 `27` 本，约为 `3 行 * 9 列`
- 列表模式默认每页 `10` 本
- 封面模式默认每页 `12` 本，约为 `3 行 * 4 列`
- 默认排序为导入顺序倒序，新导入书籍优先展示
- 标签筛选只展示标签名称和数量，选中后保持低饱和度主题样式

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
