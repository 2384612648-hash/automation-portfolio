# 服务器项目工作流

**改一件事 → 本地检查 → Git 提交与 push → CI 通过 → 上传 → sudo 升级 → 验收；失败回退。**

## 每次照做

1. 在 `personal-station` 目录运行 `git status`，再 `git pull --ff-only`；已有改动先处理。
2. 只做本次修改。AI 接续时提供：目标、当前 Git 提交、允许修改范围、验收条件。
3. 执行：

```sh
python -m unittest discover -s tests -p 'test_*.py'
npm test
npm run build
git diff --check
```

4. 审查 `git diff`，确认没有数据库、密钥、订阅或个人地址；只 `git add` 本次文件，提交并 `git push`。
5. GitHub `checks` 通过后按[部署说明](SERVER_SETUP.md#更新已有部署)上传、升级。健康接口、原收藏、快照下载和代理状态通过才算完成。
6. 只记录版本、改动、验证与回退结果；故障带时间、错误和相关几十行日志。

## 已采用 / 按需采用

| 内容 | 决定 |
| --- | --- |
| Git + GitHub Actions + 现有 Compose | 现在使用，push 自动检查；生产手动发布 |
| ShellCheck、Gitleaks | 脚本检查纳入 CI；公开推送前本地扫描凭据 |
| Restic / Backrest | 需要异盘、异机备份时选一个；先用应用快照产生一致的 SQLite 副本 |
| Dockge / Uptime Kuma | 服务多了或需要可用性检测时再部署 |
| Ansible | 换机、重建或管理多台主机时引入 |
| Renovate / pre-commit / Task | 依赖升级或重复命令明显增加时引入 |

当前单台服务器不引入 Kubernetes、自动生产部署或额外工作流平台。

## 开源参考

以下均为官方仓库，访问日期 **2026-11-05**。仅借鉴与本项目有关的做法，未安装整套工具。

| 项目 | 取什么 |
| --- | --- |
| [Docker awesome-compose](https://github.com/docker/awesome-compose) | Compose 目录、配置示例 |
| [GitHub starter-workflows](https://github.com/actions/starter-workflows) | Python/Node 自动检查范式 |
| [ShellCheck](https://github.com/koalaman/shellcheck) | 升级脚本静态检查 |
| [actionlint](https://github.com/rhysd/actionlint) | Actions 语法与表达式检查 |
| [Gitleaks](https://github.com/gitleaks/gitleaks) | 推送前查凭据 |
| [pre-commit](https://github.com/pre-commit/pre-commit) | 本地提交钩子 |
| [Task](https://github.com/go-task/task) | 跨平台统一命令 |
| [Ansible](https://github.com/ansible/ansible) | 主机配置可重复执行 |
| [Ansible for DevOps](https://github.com/geerlingguy/ansible-for-devops) | 从现成 playbook 学配置和部署 |
| [Ansible Docker role](https://github.com/geerlingguy/ansible-role-docker) | Docker 安装与服务管理 |
| [Dockge](https://github.com/louislam/dockge) | Compose 栈管理 |
| [Uptime Kuma](https://github.com/louislam/uptime-kuma) | HTTP 健康检测 |
| [Restic](https://github.com/restic/restic) | 加密、去重、异地备份和恢复 |
| [Backrest](https://github.com/garethgeorge/backrest) | Restic 图形界面、计划与恢复 |
| [Docker volume backup](https://github.com/offen/docker-volume-backup) | 卷备份、保存周期与钩子 |
| [Renovate](https://github.com/renovatebot/renovate) | 依赖更新 PR |
| [CMake Tools](https://github.com/microsoft/vscode-cmake-tools) | C++ 配置、构建、运行测试的衔接 |
| [TheAlgorithms C++](https://github.com/TheAlgorithms/C-Plus-Plus) | 小例子的源码、测试与解释组织 |

## 其他内容

学习用“改一个输入 → 预测 → 运行 → 解释 → 结果写回原记录”；知识整理用“保留来源 → 更新已有页 → 链接入口 → 记一次 log”。先复用这两条，不另建任务板或打卡表。
