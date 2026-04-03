# AI Key Vault Desktop

一个本地运行的 Electron 桌面工具，用于管理和测试 OpenAI 兼容接口配置。当前只保留 3 个核心能力：

- 连通性测试
- 模型识别
- 模型测速

原始网页项目源码保存在上级目录的 `web-source/` 中；本目录是重新封装后的桌面版工程。

## 项目组成

### 目录结构

- `electron/`
  - Electron 主进程入口、预加载脚本、状态持久化、OpenAI 兼容接口调用逻辑
- `src/`
  - React 渲染层，负责配置管理、测试面板、测速结果展示与交互
- `dist/`
  - 前端构建产物，由 `npm run build` 生成
- `release/`、`release-new*/`
  - Windows 打包输出目录
- `package.json`
  - 项目依赖、开发脚本、Electron Builder 配置
- `vite.config.ts`
  - Vite 构建配置

### 关键模块说明

- `electron/main.cjs`
  - 创建桌面窗口并注册 IPC 接口
- `electron/preload.cjs`
  - 暴露安全的渲染层 API，例如配置增删改、测速、识别、排序等
- `electron/services/state.cjs`
  - 负责本地 `state.json` 的读取、写入、配置顺序调整、置顶、测试结果持久化
- `electron/services/openai.cjs`
  - 负责调用 OpenAI 兼容接口，完成连通性测试、模型识别和模型测速
- `src/App.tsx`
  - 桌面主界面
- `src/styles.css`
  - UI 样式与布局

## 功能说明

### 1. 配置管理

- 新建配置
- 编辑配置
- 删除配置
- 拖拽排序
- 一键置顶

配置顺序会持久化保存，重启应用后不会丢失。

### 2. 连通性测试

用于验证 `Base URL` 和 `API Key` 是否可正常请求。

### 3. 模型识别

读取当前接口可用模型，并给出推荐模型。

### 4. 模型测速

对所选模型执行多轮测速，展示：

- 平均耗时
- 中位耗时
- 首包时间
- 成功率
- 推荐默认模型
- 最快模型
- 最稳定模型

测速结果支持排序展示：

- 成功的模型排前面
- 失败的模型排后面
- 同一组内按模型名称中的版本号倒序显示，例如 `gpt-5.4` 会排在 `gpt-5.3` 前面

## 开发与运行

### 安装依赖

```bash
npm install
```

### 本地开发

```bash
npm run dev
```

这会启动：

- Vite 前端开发服务
- Electron 桌面窗口

### 前端构建

```bash
npm run build
```

### Windows 打包

```bash
npm run dist
```

如果旧的打包目录被系统占用，可以使用新的输出目录重新打包，例如：

```bash
npx electron-builder --win --config.directories.output=release-new5
```

## 使用方法

### 第一步：新增配置

填写以下信息：

- 名称
- `Base URL`
- `API Key`
- 默认模型（可先留空）

### 第二步：执行连通性测试

确认当前接口地址与密钥可以正常访问。

### 第三步：执行模型识别

读取当前渠道可用模型列表，并查看推荐模型。

### 第四步：执行模型测速

在测速区：

- 勾选一个或多个需要测速的模型
- 设置测速轮数
- 点击开始测速

测速完成后，可直接在模型列表中查看各模型的状态、平均耗时、中位耗时、首包时间和成功率。

### 第五步：设置当前模型

在测速结果区域中，可将合适的模型直接设为当前模型。

### 第六步：调整配置顺序

- 直接拖拽配置行进行排序
- 点击“置顶”可将某个配置移动到最前

注意：

- 只有在未使用搜索过滤时才支持拖拽排序
- 搜索状态下仅用于浏览和定位配置，避免误改全局顺序

## 数据保存位置

应用会将配置和测试结果保存在 Electron 的用户数据目录中，文件名为：

```text
state.json
```

实际路径可通过应用运行时的 Electron `userData` 目录确定。

## 当前技术栈

- Electron
- React
- TypeScript
- Vite
- Electron Builder

## 说明

本项目是对原网页仓库的桌面化改造版本，不再依赖浏览器作为主要使用入口。
