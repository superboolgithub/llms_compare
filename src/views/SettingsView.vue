<script setup lang="ts">
import { ref } from 'vue'
import { useConfigStore } from '../stores/config'
import { fetchModels } from '../utils/api'
import type { SearchService, ApiProtocol } from '../types/config'

const configStore = useConfigStore()

// 展开状态
const expandedProviders = ref<Set<string>>(new Set())
const expandedApiKeys = ref<Set<string>>(new Set())

// 新增表单
const newProvider = ref({ name: '', baseUrl: '' })
const newApiKey = ref<{ [providerId: string]: { name: string; key: string } }>({})
const newModel = ref<{ [apiKeyId: string]: string }>({})
const newSearchService = ref({ name: '', type: 'tavily' as SearchService['type'], apiKey: '' })

// 导入导出
const importText = ref('')
const showImportModal = ref(false)

// 当前 tab
const activeTab = ref<'providers' | 'search'>('providers')

function toggleProvider(id: string) {
  if (expandedProviders.value.has(id)) {
    expandedProviders.value.delete(id)
  } else {
    expandedProviders.value.add(id)
  }
}

function toggleApiKey(id: string) {
  if (expandedApiKeys.value.has(id)) {
    expandedApiKeys.value.delete(id)
  } else {
    expandedApiKeys.value.add(id)
  }
}

function addProvider() {
  if (newProvider.value.name && newProvider.value.baseUrl) {
    const provider = configStore.addProvider(newProvider.value.name, newProvider.value.baseUrl)
    expandedProviders.value.add(provider.id)
    newProvider.value = { name: '', baseUrl: '' }
  }
}

function addApiKey(providerId: string) {
  const data = newApiKey.value[providerId]
  if (data?.name && data?.key) {
    const apiKey = configStore.addApiKey(providerId, data.name, data.key)
    if (apiKey) {
      expandedApiKeys.value.add(apiKey.id)
    }
    newApiKey.value[providerId] = { name: '', key: '' }
  }
}

function addModel(providerId: string, apiKeyId: string) {
  const modelName = newModel.value[apiKeyId]
  if (modelName) {
    configStore.addModel(providerId, apiKeyId, modelName)
    newModel.value[apiKeyId] = ''
  }
}

async function autoFetchModels(providerId: string, apiKeyId: string) {
  const provider = configStore.providers.find(p => p.id === providerId)
  const apiKey = provider?.apiKeys.find(k => k.id === apiKeyId)
  if (!provider || !apiKey) return

  const models = await fetchModels(provider.baseUrl, apiKey.key)
  for (const modelName of models) {
    if (!apiKey.models.some(m => m.name === modelName)) {
      configStore.addModel(providerId, apiKeyId, modelName)
    }
  }
}

function disableAllModels(providerId: string, apiKeyId: string) {
  const provider = configStore.providers.find(p => p.id === providerId)
  const apiKey = provider?.apiKeys.find(k => k.id === apiKeyId)
  if (!apiKey) return

  for (const model of apiKey.models) {
    if (model.enabled) {
      configStore.updateModel(providerId, apiKeyId, model.id, { enabled: false })
    }
  }
}

function addSearchService() {
  if (newSearchService.value.name && newSearchService.value.apiKey) {
    configStore.addSearchService(
      newSearchService.value.name,
      newSearchService.value.type,
      newSearchService.value.apiKey
    )
    newSearchService.value = { name: '', type: 'tavily', apiKey: '' }
  }
}

function setActiveSearchService(id: string) {
  // 先禁用所有，再启用选中的
  configStore.searchServices.forEach(s => {
    configStore.updateSearchService(s.id, { enabled: s.id === id })
  })
}

function exportConfig() {
  const json = configStore.exportConfig()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'llms_compare_config.json'
  a.click()
  URL.revokeObjectURL(url)
}

function importConfig() {
  if (configStore.importConfig(importText.value)) {
    showImportModal.value = false
    importText.value = ''
  } else {
    alert('导入失败，请检查 JSON 格式')
  }
}

function handleFileImport(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      importText.value = e.target?.result as string
    }
    reader.readAsText(file)
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '...' + key.slice(-4)
}
</script>

<template>
  <div class="settings">
    <div class="header">
      <h1>配置管理</h1>
      <div class="actions">
        <button @click="exportConfig" class="btn">导出</button>
        <button @click="showImportModal = true" class="btn">导入</button>
      </div>
    </div>

    <!-- Tab 切换 -->
    <div class="tabs">
      <button
        :class="['tab', { active: activeTab === 'providers' }]"
        @click="activeTab = 'providers'"
      >
        LLM 服务商
      </button>
      <button
        :class="['tab', { active: activeTab === 'search' }]"
        @click="activeTab = 'search'"
      >
        搜索服务
      </button>
    </div>

    <!-- LLM 服务商配置 -->
    <div v-if="activeTab === 'providers'" class="tab-content">
      <!-- 树形结构 -->
      <div class="tree">
        <div v-if="configStore.providers.length === 0" class="empty-state">
          <p>暂无配置</p>
          <p class="hint">常见 Base URL：</p>
          <code>OpenAI: https://api.openai.com/v1</code><br>
          <code>Groq: https://api.groq.com/openai/v1</code><br>
          <code>OpenRouter: https://openrouter.ai/api/v1</code>
        </div>

        <div v-for="provider in configStore.providers" :key="provider.id" class="tree-node">
          <!-- Provider 节点 -->
          <div class="tree-item provider-item">
            <span class="tree-prefix">├── </span>
            <span class="tree-toggle" @click="toggleProvider(provider.id)">
              {{ expandedProviders.has(provider.id) ? '[-]' : '[+]' }}
            </span>
            <span class="tree-icon">📦</span>
            <span class="tree-label">{{ provider.name }}</span>
            <span class="tree-meta">{{ provider.baseUrl }}</span>
            <button @click="configStore.deleteProvider(provider.id)" class="btn-icon btn-delete" title="删除">×</button>
          </div>

          <!-- Provider 子节点 -->
          <div v-if="expandedProviders.has(provider.id)" class="tree-children">
            <!-- API Key 列表 -->
            <div v-for="apiKey in provider.apiKeys" :key="apiKey.id" class="tree-node">
              <div class="tree-item apikey-item">
                <span class="tree-prefix">│   ├── </span>
                <span class="tree-toggle" @click="toggleApiKey(apiKey.id)">
                  {{ expandedApiKeys.has(apiKey.id) ? '[-]' : '[+]' }}
                </span>
                <span class="tree-icon">🔑</span>
                <span class="tree-label">{{ apiKey.name }}</span>
                <span class="tree-meta mono">{{ maskKey(apiKey.key) }}</span>
                <span class="tree-badge">{{ apiKey.models.length }} 模型</span>
                <button @click="configStore.deleteApiKey(provider.id, apiKey.id)" class="btn-icon btn-delete" title="删除">×</button>
              </div>

              <!-- API Key 子节点 -->
              <div v-if="expandedApiKeys.has(apiKey.id)" class="tree-children">
                <!-- Model 列表 -->
                <div v-for="model in apiKey.models" :key="model.id" class="tree-item model-item">
                  <span class="tree-prefix">│   │   ├── </span>
                  <label class="tree-checkbox">
                    <input
                      type="checkbox"
                      :checked="model.enabled"
                      @change="configStore.updateModel(provider.id, apiKey.id, model.id, { enabled: !model.enabled })"
                    />
                  </label>
                  <span class="tree-icon">🤖</span>
                  <span class="tree-label" :class="{ disabled: !model.enabled }">{{ model.name }}</span>
                  <select
                    class="protocol-select"
                    :value="model.protocol || 'openai'"
                    @change="(e) => configStore.updateModel(provider.id, apiKey.id, model.id, { protocol: (e.target as HTMLSelectElement).value as ApiProtocol })"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Gemini</option>
                  </select>
                  <button @click="configStore.deleteModel(provider.id, apiKey.id, model.id)" class="btn-icon btn-delete" title="删除">×</button>
                </div>

                <!-- 添加 Model 表单（和模型同级，作为最后一项） -->
                <div class="tree-item add-item">
                  <span class="tree-prefix">│   │   └── </span>
                  <span class="tree-icon add-icon">➕</span>
                  <input
                    v-model="newModel[apiKey.id]"
                    placeholder="模型名称 (如: gpt-4)"
                    class="input-sm"
                    @keyup.enter="addModel(provider.id, apiKey.id)"
                  />
                  <button @click="addModel(provider.id, apiKey.id)" class="btn btn-sm btn-primary">添加</button>
                  <button @click="autoFetchModels(provider.id, apiKey.id)" class="btn btn-sm">自动获取</button>
                  <button
                    v-if="apiKey.models.some(m => m.enabled)"
                    @click="disableAllModels(provider.id, apiKey.id)"
                    class="btn btn-sm"
                  >全不选</button>
                </div>
              </div>
            </div>

            <!-- 添加 API Key 表单（和 Key 同级，作为最后一项） -->
            <div class="tree-item add-item">
              <span class="tree-prefix">│   └── </span>
              <span class="tree-icon add-icon">➕</span>
              <input
                v-model="(newApiKey[provider.id] ??= { name: '', key: '' }).name"
                placeholder="Key 名称"
                class="input-sm"
              />
              <input
                v-model="(newApiKey[provider.id] ??= { name: '', key: '' }).key"
                placeholder="API Key"
                type="password"
                class="input-sm input-key"
              />
              <button @click="addApiKey(provider.id)" class="btn btn-sm btn-primary">添加 Key</button>
            </div>
          </div>
        </div>

        <!-- 添加 Provider 表单（和服务商同级，作为最后一项） -->
        <div class="tree-item add-item provider-item">
          <span class="tree-prefix">└── </span>
          <span class="tree-icon add-icon">➕</span>
          <input v-model="newProvider.name" placeholder="服务商名称" class="input-sm" />
          <input v-model="newProvider.baseUrl" placeholder="Base URL (如: https://api.openai.com/v1)" class="input-sm input-url" />
          <button @click="addProvider" class="btn btn-sm btn-primary">添加服务商</button>
        </div>
      </div>
    </div>

    <!-- 搜索服务配置 -->
    <div v-if="activeTab === 'search'" class="tab-content">
      <div class="add-form">
        <input v-model="newSearchService.name" placeholder="服务名称" class="input-name" />
        <select v-model="newSearchService.type" class="input-select">
          <option value="tavily">Tavily</option>
          <option value="serpapi">SerpAPI</option>
        </select>
        <input v-model="newSearchService.apiKey" placeholder="API Key" type="password" class="input-key" />
        <button @click="addSearchService" class="btn btn-primary">添加搜索服务</button>
      </div>

      <div class="search-services">
        <div v-if="configStore.searchServices.length === 0" class="empty-state">
          <p>暂无搜索服务配置</p>
          <p class="hint">支持的搜索服务：</p>
          <code>Tavily: https://tavily.com (推荐)</code><br>
          <code>SerpAPI: https://serpapi.com</code>
        </div>

        <div
          v-for="service in configStore.searchServices"
          :key="service.id"
          class="search-service-item"
          :class="{ active: service.enabled }"
        >
          <div class="service-info">
            <span class="service-icon">🔍</span>
            <span class="service-name">{{ service.name }}</span>
            <span class="service-type">{{ service.type }}</span>
            <span class="service-key mono">{{ maskKey(service.apiKey) }}</span>
          </div>
          <div class="service-actions">
            <button
              v-if="!service.enabled"
              @click="setActiveSearchService(service.id)"
              class="btn btn-sm btn-primary"
            >
              启用
            </button>
            <span v-else class="active-badge">已启用</span>
            <button @click="configStore.deleteSearchService(service.id)" class="btn btn-sm btn-danger">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 导入弹窗 -->
    <div v-if="showImportModal" class="modal-overlay" @click.self="showImportModal = false">
      <div class="modal">
        <h3>导入配置</h3>
        <div class="import-options">
          <input type="file" accept=".json" @change="handleFileImport" />
          <span>或粘贴 JSON：</span>
        </div>
        <textarea v-model="importText" placeholder="粘贴配置 JSON..." rows="10"></textarea>
        <div class="modal-actions">
          <button @click="showImportModal = false" class="btn">取消</button>
          <button @click="importConfig" class="btn btn-primary">导入</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  padding: 20px;
  max-width: 1000px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header h1 {
  margin: 0;
  font-size: 24px;
}

.actions {
  display: flex;
  gap: 10px;
}

/* Tabs */
.tabs {
  display: flex;
  gap: 5px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 10px;
}

.tab {
  padding: 8px 20px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  font-size: 14px;
}

.tab:hover {
  background: var(--bg-hover);
}

.tab.active {
  background: var(--primary-color);
  color: white;
}

.tab-content {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 添加表单 */
.add-form {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  padding: 15px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.input-name { width: 150px; }
.input-url { flex: 1; }
.input-key { flex: 1; }
.input-select { width: 120px; }

/* 树形结构 */
.tree {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 14px;
  line-height: 1.8;
}

.tree-node {
  /* 节点容器 */
}

.tree-children {
  /* 子节点容器 */
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  white-space: nowrap;
}

.tree-item:hover {
  background: var(--bg-secondary);
  border-radius: 4px;
}

.tree-prefix {
  color: var(--text-secondary);
  user-select: none;
  flex-shrink: 0;
}

.tree-toggle {
  color: var(--primary-color);
  cursor: pointer;
  user-select: none;
  font-weight: bold;
  width: 24px;
  text-align: center;
}

.tree-toggle:hover {
  color: var(--primary-hover);
}

.tree-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.tree-label {
  font-weight: 500;
  color: var(--text-primary);
}

.tree-label.disabled {
  color: var(--text-secondary);
  text-decoration: line-through;
}

.tree-meta {
  color: var(--text-secondary);
  font-size: 12px;
  margin-left: 10px;
}

.tree-meta.mono {
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.tree-badge {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  margin-left: 10px;
}

.tree-checkbox {
  display: flex;
  align-items: center;
}

.tree-checkbox input {
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.tree-empty {
  color: var(--text-secondary);
  font-style: italic;
}

.add-item {
  padding: 8px 0;
}

.add-item input {
  padding: 4px 8px;
  font-size: 12px;
}

.empty-item {
  opacity: 0.6;
}

/* Provider 样式 */
.provider-item .tree-label {
  color: #60a5fa;
}

/* API Key 样式 */
.apikey-item .tree-label {
  color: #34d399;
}

/* Model 样式 */
.model-item .tree-label {
  color: #fbbf24;
}

.protocol-select {
  padding: 2px 6px;
  font-size: 11px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  margin-left: 8px;
}

.protocol-select:focus {
  outline: none;
  border-color: var(--primary-color);
}

/* 添加项样式 */
.add-icon {
  opacity: 0.6;
}

.add-item:hover .add-icon {
  opacity: 1;
}

/* 搜索服务 */
.search-services {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.search-service-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 2px solid transparent;
}

.search-service-item.active {
  border-color: var(--primary-color);
}

.service-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.service-icon {
  font-size: 20px;
}

.service-name {
  font-weight: 600;
}

.service-type {
  background: var(--bg-tertiary);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  text-transform: uppercase;
}

.service-key {
  color: var(--text-secondary);
  font-size: 12px;
}

.service-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.active-badge {
  color: var(--primary-color);
  font-size: 13px;
  font-weight: 500;
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--text-secondary);
}

.empty-state code {
  display: block;
  margin: 5px 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.hint {
  font-size: 13px;
  margin-top: 15px;
}

/* 按钮 */
.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  white-space: nowrap;
}

.btn:hover {
  background: var(--bg-hover);
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-danger {
  background: #dc3545;
  color: white;
}

.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}

.btn-icon {
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 14px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.tree-item:hover .btn-icon {
  opacity: 1;
}

.btn-icon:hover {
  background: var(--bg-hover);
}

.btn-delete:hover {
  color: #dc3545;
}

/* 输入框 */
input, select, textarea {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
}

input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: var(--primary-color);
}

.input-sm {
  padding: 4px 8px;
  font-size: 12px;
}

.mono {
  font-family: 'SF Mono', 'Fira Code', monospace;
}

/* 弹窗 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--bg-primary);
  padding: 20px;
  border-radius: 12px;
  width: 500px;
  max-width: 90vw;
}

.modal h3 {
  margin: 0 0 15px 0;
}

.import-options {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.modal textarea {
  width: 100%;
  font-family: monospace;
  font-size: 12px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 15px;
}
</style>
