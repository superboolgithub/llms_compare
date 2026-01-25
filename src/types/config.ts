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
  type: 'tavily' | 'serpapi' | 'custom'
  apiKey: string
  baseUrl?: string // 自定义服务时使用
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

export interface ComparePanel {
  id: string
  selection: ModelSelection | null
  messages: Message[]
  streaming: boolean
}
