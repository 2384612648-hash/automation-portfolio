# 零域 ZERO

家庭服务器上的个人信息站：RSS、收藏、行情、汇率与浏览器工具。Python + SQLite + 原生 JavaScript，Docker Compose 部署。

当前代码 **0.6.0**：绯夜界面、生成图片、透明 3D 帧与实时光场；首页接入真实订阅和服务器状态，一言与行情按需展开。保留收藏、14 项本地工具、快照和代理功能。生产部署需单独执行，Git push 不更新服务器。

## 本地运行

需要 Python 3.13、Node.js 22。

```sh
npm ci
npm run build
python server.py
```

打开 `http://127.0.0.1:8765`。收藏和 RSS 可直接使用；离线翻译与代理内核需准备 Linux 运行资源，见[部署](SERVER_SETUP.md)。

## 检查

```sh
python -m unittest discover -s tests -p 'test_*.py'
npm test
npm run build
```

## 维护

- [日常开发与发布工作流](WORKFLOW.md)
- [首次部署、升级与回退](SERVER_SETUP.md)
- [第三方许可](THIRD_PARTY_NOTICES.md)

数据库、`.env`、订阅、私钥和大型模型不入 Git。快照包含收藏库与信息流库，每约 24 小时检查生成，保留最近 7 份；不含代理凭据、`.env` 或浏览器偏好。同盘快照还需下载到另一台设备。
