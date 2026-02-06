// 配置类型定义

export type ApiProtocol = 'openai' | 'anthropic' | 'gemini'

export interface Model {
  id: string
  name: string
  enabled: boolean
  protocol?: ApiProtocol // 可选，默认 openai
}

export interface ApiKey {
  id: string
  name: string
  key: string
  models: Model[]
}

export interface Provider {
  id: string
  name: string
  baseUrl: string
  apiKeys: ApiKey[]
}

// 搜索服务配置
export interface SearchService {
  id: string
  name: string
  type: 'tavily' | 'serpapi' | 'searxng'
  apiKey: string           // Tavily/SerpAPI 的 API Key，SearXNG 的 Basic Auth 密码
  baseUrl?: string         // SearXNG 的服务地址
  proxyUrl?: string        // CORS 代理地址（用于生产环境）
  username?: string        // SearXNG 的 Basic Auth 用户名
  enabled: boolean
}

export interface AppConfig {
  providers: Provider[]
  searchServices: SearchService[]
  theme: 'light' | 'dark'
}

// 对话相关类型
export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

// 多模型对比相关
export interface ModelSelection {
  providerId: string
  apiKeyId: string
  modelId: string
}

// 临时 API 配置
export interface TempApiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface ComparePanel {
  id: string
  selection: ModelSelection | null
  tempApi?: TempApiConfig  // 临时 API 配置
  messages: Message[]
  streaming: boolean
}
