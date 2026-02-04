# LLM Compare

一个多模型对比聊天工具，支持同时与多个 LLM 模型对话并比较它们的回复。

## 功能特性

- **多模型并行对话** - 同时向多个 LLM 发送相同问题，实时对比回复
- **灵活的面板管理** - 可自由添加/删除对话面板，每个面板独立选择模型
- **流式响应** - 支持 SSE 流式输出，实时显示模型回复
- **多协议支持** - 兼容 OpenAI、Anthropic、Gemini 等 API 协议
- **配置管理** - 支持多服务商、多 API Key、多模型的层级配置
- **搜索服务集成** - 支持 Tavily、SerpAPI 等搜索服务
- **数据持久化** - 配置和对话历史自动保存到 localStorage
- **导入/导出** - 支持配置的 JSON 导入导出

## 技术栈

- **前端框架**: Vue 3 + TypeScript
- **构建工具**: Vite 7
- **状态管理**: Pinia
- **路由**: Vue Router 4
- **Markdown 渲染**: Marked
- **代码高亮**: Highlight.js

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:5173

### 构建生产版本

```bash
npm run build
```

### 预览生产版本

```bash
npm run preview
```

## 项目结构

```
src/
├── components/       # 通用组件
├── views/           # 页面视图
│   ├── ChatView.vue     # 聊天对比页面
│   └── SettingsView.vue # 配置管理页面
├── stores/          # Pinia 状态管理
│   ├── config.ts        # 配置状态
│   └── chat.ts          # 聊天状态
├── types/           # TypeScript 类型定义
│   └── config.ts        # 配置相关类型
├── utils/           # 工具函数
│   ├── api.ts           # API 调用封装
│   └── search.ts        # 搜索服务封装
├── router/          # 路由配置
├── App.vue          # 根组件
└── main.ts          # 入口文件
```

## 配置说明

### 服务商配置

支持配置多个 LLM 服务商，每个服务商可以有多个 API Key，每个 Key 下可以配置多个模型。

**常见 Base URL：**

| 服务商 | Base URL |
|--------|----------|
| OpenAI | `https://api.openai.com/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Together AI | `https://api.together.xyz/v1` |
| Anthropic | `https://api.anthropic.com` |

### API 协议

每个模型可以单独设置 API 协议：

- **OpenAI** - 标准 OpenAI Chat Completions API
- **Anthropic** - Anthropic Messages API
- **Gemini** - Google Gemini API

### 搜索服务

支持集成搜索服务用于增强对话：

- **Tavily** - https://tavily.com (推荐)
- **SerpAPI** - https://serpapi.com

## 使用方法

1. **配置服务商** - 进入设置页面，添加 LLM 服务商和 API Key
2. **添加模型** - 在 API Key 下添加要使用的模型，可手动输入或自动获取
3. **开始对话** - 返回聊天页面，选择模型后即可开始对话
4. **多模型对比** - 点击 "+" 添加更多面板，选择不同模型进行对比

## 配置文件

配置存储在浏览器 localStorage 中，key 为 `llms_compare_config`。

可以通过设置页面的导出功能备份配置，或导入已有配置。

**注意**: 请勿将包含 API Key 的配置文件提交到公开仓库。

## License

MIT
