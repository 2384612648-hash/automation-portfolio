# 零域部署

Linux amd64 + Docker Compose。私密配置留在服务器，网站仅绑定 `127.0.0.1:8765`，通过 Tailscale Serve 访问。

## 首次安装

在本地 `personal-station` 目录执行：

```sh
npm ci
npm run build
python deploy/fetch_assets.py
python deploy/upload.py USER@HOST --assets
```

资源来自固定版本的 mihomo 和 Hugging Face 模型；模型与内核校验 SHA-256，Python wheels 固定版本，目标为 Python 3.13/Linux amd64。首次上传后在服务器执行：

```sh
mkdir -p ~/services/zero
cp -a ~/services/zero-incoming/. ~/services/zero/
cd ~/services/zero
cp .env.example .env
nano .env
sudo docker compose up -d --build
sudo tailscale serve --bg http://127.0.0.1:8765
curl -f http://127.0.0.1:8765/api/health
```

`.env` 中填 Serve 的实际 HTTPS origin；仅首次安装使用这些步骤。已有部署不再复制 `.env.example`。

## 更新已有部署

先按[工作流](WORKFLOW.md)完成检查和 Git 提交，再上传：

```sh
python deploy/upload.py USER@HOST
```

默认仅上传 Git 已跟踪文件；使用当前工作区内容，上传前保持工作区干净。修改运行依赖时先抓取资源并加 `--assets`。SSH 密钥可用 `--identity PATH`；已有主机别名可用 `--host-key-alias ALIAS`，保持主机密钥校验。

在服务器执行：

```sh
sudo bash ~/services/zero-incoming/deploy/upgrade.sh
curl -f http://127.0.0.1:8765/api/health
curl -f http://127.0.0.1:8765/api/backups
```

脚本使用现有镜像离线构建，先在临时数据中检查代理、翻译、快照及双库恢复，再重建 zero。保留 `.env`、数据卷和代理状态；切换后失败尝试恢复上一镜像。默认目标为暂存目录的同级 `zero`，可用 `ZERO_TARGET_DIR` 指定。

验收：版本为 0.5.1；原收藏可见；数据中心可生成、列出和下载快照；代理开关保持原状态。后台约启动 30 秒后检查是否需要首份快照，之后每半小时检查，距上份满 24 小时再生成。

## 回退

```sh
cd ~/services/zero
sudo docker tag zero-station:previous zero-station:local
sudo docker compose up -d --no-build --pull never zero
curl -f http://127.0.0.1:8765/api/health
```

这是镜像回退，源码仍是新版。后续重新上传需要的 Git 版本。不要删除数据卷，也不要用旧电脑数据库覆盖生产数据。升级需要本人 sudo 密码，密码只在本人终端输入。
