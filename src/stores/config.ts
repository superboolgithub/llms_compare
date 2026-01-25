import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Provider, ApiKey, Model, AppConfig, SearchService, ApiProtocol } from '../types/config'

const STORAGE_KEY = 'llms_compare_config'

function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

export const useConfigStore = defineStore('config', () => {
  const providers = ref<Provider[]>([])
  const searchServices = ref<SearchService[]>([])
  const theme = ref<'light' | 'dark'>('dark')

  // 从 localStorage 加载配置
  function loadConfig() {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const config: AppConfig = JSON.parse(saved)
        providers.value = config.providers || []
        searchServices.value = config.searchServices || []
        theme.value = config.theme || 'dark'
      } catch (e) {
        console.error('Failed to load config:', e)
      }
    }
  }

  // 保存配置到 localStorage
  function saveConfig() {
    const config: AppConfig = {
      providers: providers.value,
      searchServices: searchServices.value,
      theme: theme.value
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  }

  // 导出配置为 JSON
  function exportConfig(): string {
    return JSON.stringify({
      providers: providers.value,
      searchServices: searchServices.value,
      theme: theme.value
    }, null, 2)
  }

  // 导入配置
  function importConfig(jsonStr: string): boolean {
    try {
      const config: AppConfig = JSON.parse(jsonStr)
      if (config.providers) {
        providers.value = config.providers
        searchServices.value = config.searchServices || []
        theme.value = config.theme || 'dark'
        saveConfig()
        return true
      }
      return false
    } catch (e) {
      console.error('Failed to import config:', e)
      return false
    }
  }

  // Provider 操作
  function addProvider(name: string, baseUrl: string): Provider {
    const provider: Provider = {
      id: generateId(),
      name,
      baseUrl: baseUrl.replace(/\/$/, ''),
      apiKeys: []
    }
    providers.value.push(provider)
    saveConfig()
    return provider
  }

  function updateProvider(id: string, updates: Partial<Pick<Provider, 'name' | 'baseUrl'>>) {
    const provider = providers.value.find(p => p.id === id)
    if (provider) {
      if (updates.name) provider.name = updates.name
      if (updates.baseUrl) provider.baseUrl = updates.baseUrl.replace(/\/$/, '')
      saveConfig()
    }
  }

  function deleteProvider(id: string) {
    const index = providers.value.findIndex(p => p.id === id)
    if (index !== -1) {
      providers.value.splice(index, 1)
      saveConfig()
    }
  }

  // API Key 操作
  function addApiKey(providerId: string, name: string, key: string): ApiKey | null {
    const provider = providers.value.find(p => p.id === providerId)
    if (!provider) return null

    const apiKey: ApiKey = {
      id: generateId(),
      name,
      key,
      models: []
    }
    provider.apiKeys.push(apiKey)
    saveConfig()
    return apiKey
  }

  function updateApiKey(providerId: string, apiKeyId: string, updates: Partial<Pick<ApiKey, 'name' | 'key'>>) {
    const provider = providers.value.find(p => p.id === providerId)
    const apiKey = provider?.apiKeys.find(k => k.id === apiKeyId)
    if (apiKey) {
      if (updates.name) apiKey.name = updates.name
      if (updates.key) apiKey.key = updates.key
      saveConfig()
    }
  }

  function deleteApiKey(providerId: string, apiKeyId: string) {
    const provider = providers.value.find(p => p.id === providerId)
    if (provider) {
      const index = provider.apiKeys.findIndex(k => k.id === apiKeyId)
      if (index !== -1) {
        provider.apiKeys.splice(index, 1)
        saveConfig()
      }
    }
  }

  // Model 操作
  function addModel(providerId: string, apiKeyId: string, modelName: string): Model | null {
    const provider = providers.value.find(p => p.id === providerId)
    const apiKey = provider?.apiKeys.find(k => k.id === apiKeyId)
    if (!apiKey) return null

    const model: Model = {
      id: generateId(),
      name: modelName,
      enabled: true
    }
    apiKey.models.push(model)
    saveConfig()
    return model
  }

  function updateModel(providerId: string, apiKeyId: string, modelId: string, updates: Partial<Pick<Model, 'name' | 'enabled' | 'protocol'>>) {
    const provider = providers.value.find(p => p.id === providerId)
    const apiKey = provider?.apiKeys.find(k => k.id === apiKeyId)
    const model = apiKey?.models.find(m => m.id === modelId)
    if (model) {
      if (updates.name !== undefined) model.name = updates.name
      if (updates.enabled !== undefined) model.enabled = updates.enabled
      if (updates.protocol !== undefined) model.protocol = updates.protocol
      saveConfig()
    }
  }

  function deleteModel(providerId: string, apiKeyId: string, modelId: string) {
    const provider = providers.value.find(p => p.id === providerId)
    const apiKey = provider?.apiKeys.find(k => k.id === apiKeyId)
    if (apiKey) {
      const index = apiKey.models.findIndex(m => m.id === modelId)
      if (index !== -1) {
        apiKey.models.splice(index, 1)
        saveConfig()
      }
    }
  }

  // 搜索服务操作
  function addSearchService(name: string, type: SearchService['type'], apiKey: string, baseUrl?: string): SearchService {
    const service: SearchService = {
      id: generateId(),
      name,
      type,
      apiKey,
      baseUrl,
      enabled: true
    }
    searchServices.value.push(service)
    saveConfig()
    return service
  }

  function updateSearchService(id: string, updates: Partial<Omit<SearchService, 'id'>>) {
    const service = searchServices.value.find(s => s.id === id)
    if (service) {
      Object.assign(service, updates)
      saveConfig()
    }
  }

  function deleteSearchService(id: string) {
    const index = searchServices.value.findIndex(s => s.id === id)
    if (index !== -1) {
      searchServices.value.splice(index, 1)
      saveConfig()
    }
  }

  // 获取启用的搜索服务
  const enabledSearchService = computed(() => {
    return searchServices.value.find(s => s.enabled)
  })

  // 获取所有可用的模型（扁平化列表）
  const availableModels = computed(() => {
    const result: Array<{
      provider: Provider
      apiKey: ApiKey
      model: Model
    }> = []

    for (const provider of providers.value) {
      for (const apiKey of provider.apiKeys) {
        for (const model of apiKey.models) {
          if (model.enabled) {
            result.push({ provider, apiKey, model })
          }
        }
      }
    }
    return result
  })

  // 初始化时加载配置
  loadConfig()

  return {
    providers,
    searchServices,
    theme,
    availableModels,
    enabledSearchService,
    loadConfig,
    saveConfig,
    exportConfig,
    importConfig,
    addProvider,
    updateProvider,
    deleteProvider,
    addApiKey,
    updateApiKey,
    deleteApiKey,
    addModel,
    updateModel,
    deleteModel,
    addSearchService,
    updateSearchService,
    deleteSearchService
  }
})
