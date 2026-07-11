# Books

Books 是一个可以自己部署的网页书库。

你可以把电子书都放在服务器上，然后在浏览器里登录阅读、管理、下载。它基于 Koodo Reader 改造，保留了 Koodo 的阅读体验，同时增加了服务端书库、多用户、图书权限、豆瓣元信息、封面本地保存、标签筛选等功能。

适合这些场景：

- 家里 NAS 上放一个统一书库
- 多台电脑、手机、平板共用一个网页阅读入口
- 管理员上传书籍，普通用户只看自己有权限看的书
- 从豆瓣补全书名、作者、简介、标签、评分、封面

## 已有镜像

已经推送到阿里云镜像仓库：

```bash
registry.cn-hangzhou.aliyuncs.com/qiang2024_docker/books:bd406af6
```

拉取镜像：

```bash
docker pull registry.cn-hangzhou.aliyuncs.com/qiang2024_docker/books:bd406af6
```

镜像信息：

- 镜像地址：`registry.cn-hangzhou.aliyuncs.com/qiang2024_docker/books:bd406af6`
- 对应代码提交：`bd406af6 Enhance centralized Books library`
- 镜像 digest：`sha256:de361422a4bf23d2e2b188ef29d11ad6fea4b0af9c39bc80ed5e9d49c2bd31c3`

## 最简单运行方式

先创建数据目录：

```bash
mkdir -p /vol1/data/Books/data/uploads
```

启动容器：

```bash
docker run -d \
  --name koodo-centralized \
  --restart unless-stopped \
  -p 18083:8080 \
  -e SERVER_USERNAME=admin \
  -e SERVER_PASSWORD='ChangeMe_2026!' \
  -e ENABLE_HTTP_SERVER=true \
  -e ENABLE_LIBRARY_SERVER=true \
  -e ENABLE_OPDS=true \
  -e STATIC_DIR=/app/build \
  -e PORT=8080 \
  -v /vol1/data/Books/data/uploads:/app/uploads \
  registry.cn-hangzhou.aliyuncs.com/qiang2024_docker/books:bd406af6
```

打开浏览器访问：

```text
http://服务器IP:18083
```

默认账号：

```text
用户名：admin
密码：ChangeMe_2026!
```

OPDS 地址：

```text
http://服务器IP:18083/opds
```

## 数据放在哪里

容器里统一使用：

```text
/app/uploads
```

推荐挂载到宿主机：

```text
/vol1/data/Books/data/uploads
```

目录大概长这样：

```text
/vol1/data/Books/data/uploads
├── book/      # 书籍文件
├── cover/     # 封面文件
└── config/    # 数据库、配置、笔记、阅读进度
```

只要这个目录不删，重建容器后书库数据还在。

## Docker Compose 运行

仓库里已经带了 `docker-compose.yml`。

启动：

```bash
docker compose up -d
```

如果要重新构建后启动：

```bash
docker compose up --build -d
```

停止：

```bash
docker compose down
```

查看日志：

```bash
docker logs -f koodo-centralized
```

## 自己构建镜像

在项目根目录执行：

```bash
docker build -t koodo-centralized:local .
```

构建完成后运行本地镜像：

```bash
docker run -d \
  --name koodo-centralized \
  --restart unless-stopped \
  -p 18083:8080 \
  -e SERVER_USERNAME=admin \
  -e SERVER_PASSWORD='ChangeMe_2026!' \
  -e ENABLE_HTTP_SERVER=true \
  -e ENABLE_LIBRARY_SERVER=true \
  -e ENABLE_OPDS=true \
  -e STATIC_DIR=/app/build \
  -e PORT=8080 \
  -v /vol1/data/Books/data/uploads:/app/uploads \
  koodo-centralized:local
```

如果 Docker Hub 网络不稳定，可以用本地打包脚本：

```bash
chmod +x scripts/package-local-image.sh
./scripts/package-local-image.sh
```

生成的镜像名也是：

```text
koodo-centralized:local
```

## 推送镜像到阿里云

先登录阿里云镜像仓库：

```bash
docker login --username=你的阿里云用户名 registry.cn-hangzhou.aliyuncs.com
```

给本地镜像打标签：

```bash
docker tag koodo-centralized:local registry.cn-hangzhou.aliyuncs.com/qiang2024_docker/books:你的版本号
```

推送：

```bash
docker push registry.cn-hangzhou.aliyuncs.com/qiang2024_docker/books:你的版本号
```

例子：

```bash
docker tag koodo-centralized:local registry.cn-hangzhou.aliyuncs.com/qiang2024_docker/books:bd406af6
docker push registry.cn-hangzhou.aliyuncs.com/qiang2024_docker/books:bd406af6
```

## 更新容器

如果已经有旧容器，先停止并删除：

```bash
docker stop koodo-centralized
docker rm koodo-centralized
```

拉新镜像：

```bash
docker pull registry.cn-hangzhou.aliyuncs.com/qiang2024_docker/books:bd406af6
```

再按“最简单运行方式”重新启动。

只要挂载目录还是：

```text
/vol1/data/Books/data/uploads:/app/uploads
```

原来的书籍、封面、账号、笔记、阅读进度都会保留。

## 主要功能

- 网页登录访问书库
- 管理员上传书籍
- 多用户账号管理
- 不同用户可以看到不同书籍
- 书籍详情页支持封面、简介、下载、阅读、笔记
- 首页支持分页，书多时不会一次性加载全部
- 首页支持标签筛选，并显示标签下书籍数量
- 默认按导入顺序倒序展示，新导入的书在前面
- 支持明暗主题切换
- 支持 OPDS
- 支持豆瓣搜索元信息
- 保存豆瓣元信息时，会把豆瓣封面下载成本地封面

## 豆瓣元信息

在书籍详情页点击“豆瓣”，可以搜索豆瓣元信息。

可以同步：

- 书名
- 作者
- 出版社
- ISBN
- 简介
- 标签
- 评分
- 封面

封面不会长期使用豆瓣外链。保存后，后端会下载图片到：

```text
/app/uploads/cover
```

如果豆瓣图片直连失败，镜像里已经内置 `douban-api-rs` 作为本地兜底代理，不需要再单独启动 `douban-api-rs` 容器。

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

构建前端：

```bash
pnpm build
```

启动 Go 后端：

```bash
cd httpserver
STATIC_DIR=../build ENABLE_HTTP_SERVER=true ENABLE_LIBRARY_SERVER=true ENABLE_OPDS=true PORT=8080 go run .
```

测试 Go 后端：

```bash
cd httpserver
go test ./...
```

## 常用排查命令

查看容器是否运行：

```bash
docker ps | grep koodo-centralized
```

查看日志：

```bash
docker logs -f koodo-centralized
```

进入书库数据目录：

```bash
cd /vol1/data/Books/data/uploads
```

查看封面文件：

```bash
ls -lh /vol1/data/Books/data/uploads/cover
```

## 关键文件

- `Dockerfile`：构建镜像
- `docker-compose.yml`：Compose 启动配置
- `httpserver/library.go`：服务端书库接口
- `httpserver/douban.go`：豆瓣元信息获取
- `src/utils/storage/serverLibrary.ts`：前端调用服务端书库
- `src/components/dialogs/detailDialog/component.tsx`：书籍详情页

## 注意事项

- 一定要挂载 `/app/uploads`，否则容器删除后数据也会丢。
- 管理员默认密码建议部署后尽快修改。
- 当前项目已经不是原版 Koodo Reader，而是面向自托管中心化书库的 Books。
