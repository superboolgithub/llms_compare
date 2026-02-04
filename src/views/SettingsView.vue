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

// 编辑状态
const editingProvider = ref<{ id: string; name: string; baseUrl: string } | null>(null)
const editingApiKey = ref<{ providerId: string; id: string; name: string; key: string } | null>(null)
const editingModel = ref<{ providerId: string; apiKeyId: string; id: string; name: string } | null>(null)
const editingSearchService = ref<{ id: string; name: string; type: SearchService['type']; apiKey: string } | null>(null)

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

// 编辑 Provider
function startEditProvider(provider: { id: string; name: string; baseUrl: string }) {
  editingProvider.value = { ...provider }
}

function saveEditProvider() {
  if (editingProvider.value && editingProvider.value.name && editingProvider.value.baseUrl) {
    configStore.updateProvider(editingProvider.value.id, {
      name: editingProvider.value.name,
      baseUrl: editingProvider.value.baseUrl
    })
    editingProvider.value = null
  }
}

function cancelEditProvider() {
  editingProvider.value = null
}

// 编辑 API Key
function startEditApiKey(providerId: string, apiKey: { id: string; name: string; key: string }) {
  editingApiKey.value = { providerId, ...apiKey }
}

function saveEditApiKey() {
  if (editingApiKey.value && editingApiKey.value.name && editingApiKey.value.key) {
    configStore.updateApiKey(editingApiKey.value.providerId, editingApiKey.value.id, {
      name: editingApiKey.value.name,
      key: editingApiKey.value.key
    })
    editingApiKey.value = null
  }
}

function cancelEditApiKey() {
  editingApiKey.value = null
}

// 编辑 Model
function startEditModel(providerId: string, apiKeyId: string, model: { id: string; name: string }) {
  editingModel.value = { providerId, apiKeyId, ...model }
}

function saveEditModel() {
  if (editingModel.value && editingModel.value.name) {
    configStore.updateModel(editingModel.value.providerId, editingModel.value.apiKeyId, editingModel.value.id, {
      name: editingModel.value.name
    })
    editingModel.value = null
  }
}

function cancelEditModel() {
  editingModel.value = null
}

// 编辑 SearchService
function startEditSearchService(service: { id: string; name: string; type: SearchService['type']; apiKey: string }) {
  editingSearchService.value = { ...service }
}

function saveEditSearchService() {
  if (editingSearchService.value && editingSearchService.value.name && editingSearchService.value.apiKey) {
    configStore.updateSearchService(editingSearchService.value.id, {
      name: editingSearchService.value.name,
      type: editingSearchService.value.type,
      apiKey: editingSearchService.value.apiKey
    })
    editingSearchService.value = null
  }
}

function cancelEditSearchService() {
  editingSearchService.value = null
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
          <!-- Provider 节点 - 编辑模式 -->
          <div v-if="editingProvider?.id === provider.id" class="tree-item provider-item editing">
            <span class="tree-prefix">├── </span>
            <span class="tree-icon">📦</span>
            <input
              v-model="editingProvider.name"
              placeholder="服务商名称"
              class="input-sm"
              @keyup.enter="saveEditProvider"
            />
            <input
              v-model="editingProvider.baseUrl"
              placeholder="Base URL"
              class="input-sm input-url"
              @keyup.enter="saveEditProvider"
            />
            <button @click="saveEditProvider" class="btn btn-sm btn-primary">保存</button>
            <button @click="cancelEditProvider" class="btn btn-sm">取消</button>
          </div>
          <!-- Provider 节点 - 显示模式 -->
          <div v-else class="tree-item provider-item">
            <span class="tree-prefix">├── </span>
            <span class="tree-toggle" @click="toggleProvider(provider.id)">
              {{ expandedProviders.has(provider.id) ? '[-]' : '[+]' }}
            </span>
            <span class="tree-icon">📦</span>
            <span class="tree-label">{{ provider.name }}</span>
            <span class="tree-meta">{{ provider.baseUrl }}</span>
            <button @click="startEditProvider(provider)" class="btn-icon btn-edit" title="编辑">✎</button>
            <button @click="configStore.deleteProvider(provider.id)" class="btn-icon btn-delete" title="删除">×</button>
          </div>

          <!-- Provider 子节点 -->
          <div v-if="expandedProviders.has(provider.id)" class="tree-children">
            <!-- API Key 列表 -->
            <div v-for="apiKey in provider.apiKeys" :key="apiKey.id" class="tree-node">
              <!-- API Key - 编辑模式 -->
              <div v-if="editingApiKey?.id === apiKey.id" class="tree-item apikey-item editing">
                <span class="tree-prefix">│   ├── </span>
                <span class="tree-icon">🔑</span>
                <input
                  v-model="editingApiKey.name"
                  placeholder="Key 名称"
                  class="input-sm"
                  @keyup.enter="saveEditApiKey"
                />
                <input
                  v-model="editingApiKey.key"
                  placeholder="API Key"
                  type="password"
                  class="input-sm input-key"
                  @keyup.enter="saveEditApiKey"
                />
                <button @click="saveEditApiKey" class="btn btn-sm btn-primary">保存</button>
                <button @click="cancelEditApiKey" class="btn btn-sm">取消</button>
              </div>
              <!-- API Key - 显示模式 -->
              <div v-else class="tree-item apikey-item">
                <span class="tree-prefix">│   ├── </span>
                <span class="tree-toggle" @click="toggleApiKey(apiKey.id)">
                  {{ expandedApiKeys.has(apiKey.id) ? '[-]' : '[+]' }}
                </span>
                <span class="tree-icon">🔑</span>
                <span class="tree-label">{{ apiKey.name }}</span>
                <span class="tree-meta mono">{{ maskKey(apiKey.key) }}</span>
                <span class="tree-badge">{{ apiKey.models.length }} 模型</span>
                <button @click="startEditApiKey(provider.id, apiKey)" class="btn-icon btn-edit" title="编辑">✎</button>
                <button @click="configStore.deleteApiKey(provider.id, apiKey.id)" class="btn-icon btn-delete" title="删除">×</button>
              </div>

              <!-- API Key 子节点 -->
              <div v-if="expandedApiKeys.has(apiKey.id)" class="tree-children">
                <!-- Model 列表 -->
                <div v-for="model in apiKey.models" :key="model.id">
                  <!-- Model - 编辑模式 -->
                  <div v-if="editingModel?.id === model.id" class="tree-item model-item editing">
                    <span class="tree-prefix">│   │   ├── </span>
                    <span class="tree-icon">🤖</span>
                    <input
                      v-model="editingModel.name"
                      placeholder="模型名称"
                      class="input-sm"
                      @keyup.enter="saveEditModel"
                    />
                    <button @click="saveEditModel" class="btn btn-sm btn-primary">保存</button>
                    <button @click="cancelEditModel" class="btn btn-sm">取消</button>
                  </div>
                  <!-- Model - 显示模式 -->
                  <div v-else class="tree-item model-item">
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
                    <button @click="startEditModel(provider.id, apiKey.id, model)" class="btn-icon btn-edit" title="编辑">✎</button>
                    <button @click="configStore.deleteModel(provider.id, apiKey.id, model.id)" class="btn-icon btn-delete" title="删除">×</button>
                  </div>
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
          <!-- 编辑模式 -->
          <template v-if="editingSearchService?.id === service.id">
            <div class="service-edit-form">
              <input
                v-model="editingSearchService.name"
                placeholder="服务名称"
                class="input-sm"
              />
              <select v-model="editingSearchService.type" class="input-select-sm">
                <option value="tavily">Tavily</option>
                <option value="serpapi">SerpAPI</option>
              </select>
              <input
                v-model="editingSearchService.apiKey"
                placeholder="API Key"
                type="password"
                class="input-sm input-key"
              />
            </div>
            <div class="service-actions">
              <button @click="saveEditSearchService" class="btn btn-sm btn-primary">保存</button>
              <button @click="cancelEditSearchService" class="btn btn-sm">取消</button>
            </div>
          </template>
          <!-- 显示模式 -->
          <template v-else>
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
              <button @click="startEditSearchService(service)" class="btn btn-sm">编辑</button>
              <button @click="configStore.deleteSearchService(service.id)" class="btn btn-sm btn-danger">删除</button>
            </div>
          </template>
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
  padding: 24px 32px;
  max-width: 1100px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-color);
}

.header h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  color: var(--text-primary);
}

.actions {
  display: flex;
  gap: 12px;
}

/* Tabs */
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  padding: 6px;
  background: var(--glass-bg);
  border-radius: 12px;
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-color);
  width: fit-content;
}

.tab {
  padding: 10px 24px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  font-family: var(--font-display);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.tab:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.tab.active {
  background: var(--gradient-primary);
  color: white;
  font-weight: 600;
  box-shadow: var(--shadow-glow);
}

.tab-content {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 添加表单 */
.add-form {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  padding: 18px;
  background: var(--glass-bg);
  border-radius: 12px;
  border: 1px solid var(--border-color);
  backdrop-filter: blur(10px);
}

.input-name { width: 160px; }
.input-url { flex: 1; }
.input-key { flex: 1; }
.input-select { width: 130px; }

/* 树形结构 */
.tree {
  font-family: var(--font-display);
  font-size: 14px;
  line-height: 1.8;
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  gap: 10px;
  padding: 6px 10px;
  white-space: nowrap;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.tree-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.tree-prefix {
  display: none;
}

.tree-toggle {
  color: var(--primary-purple);
  cursor: pointer;
  user-select: none;
  font-weight: 600;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  background: var(--primary-light);
  border-radius: 6px;
  transition: all 0.2s ease;
}

.tree-toggle:hover {
  background: rgba(124, 58, 237, 0.25);
}

.tree-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.tree-label {
  font-weight: 600;
  color: var(--text-primary);
}

.tree-label.disabled {
  color: var(--text-muted);
  text-decoration: line-through;
  opacity: 0.5;
}

.tree-meta {
  color: var(--text-secondary);
  font-size: 12px;
  margin-left: 8px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.tree-meta.mono {
  font-family: var(--font-mono);
}

.tree-badge {
  background: var(--gradient-subtle);
  color: var(--accent-violet);
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 11px;
  margin-left: 8px;
  font-weight: 600;
  border: 1px solid var(--border-hover);
}

.tree-checkbox {
  display: flex;
  align-items: center;
}

.tree-checkbox input {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--primary-purple);
}

.tree-empty {
  color: var(--text-secondary);
  font-style: italic;
}

.add-item {
  padding: 12px;
  margin-top: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 2px dashed rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  transition: all 0.3s ease;
}

.add-item:hover {
  border-color: var(--border-hover);
  background: var(--primary-light);
}

.add-item input {
  padding: 8px 12px;
  font-size: 13px;
}

.empty-item {
  opacity: 0.6;
}

/* ========== Provider 卡片样式 ========== */
.provider-item {
  background: var(--gradient-subtle);
  border: 1px solid var(--border-hover);
  border-radius: 14px;
  padding: 14px 18px !important;
  transition: all 0.2s ease;
}

.provider-item:hover {
  border-color: var(--primary-color);
  box-shadow: var(--shadow-glow);
}

.provider-item .tree-label {
  color: var(--primary-blue);
  font-size: 16px;
}

.provider-item .tree-icon {
  font-size: 22px;
}

.provider-item.add-item {
  background: transparent;
  border: 2px dashed var(--border-hover);
}

.provider-item.add-item:hover {
  border-color: var(--primary-color);
  background: var(--primary-light);
}

/* Provider 子节点容器 */
.tree-node > .tree-children {
  margin-left: 24px;
  margin-top: 14px;
  padding-left: 18px;
  border-left: 2px solid rgba(99, 102, 241, 0.2);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ========== API Key 卡片样式 ========== */
.apikey-item {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.04) 100%);
  border: 1px solid rgba(16, 185, 129, 0.25);
  border-radius: 12px;
  padding: 12px 16px !important;
  transition: all 0.2s ease;
}

.apikey-item:hover {
  border-color: rgba(16, 185, 129, 0.4);
  box-shadow: 0 0 15px rgba(16, 185, 129, 0.12);
}

.apikey-item .tree-label {
  color: #10b981;
  font-size: 14px;
}

.apikey-item .tree-icon {
  font-size: 17px;
}

.apikey-item .tree-badge {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.1) 100%);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.3);
}

.apikey-item.add-item {
  background: transparent;
  border: 2px dashed rgba(16, 185, 129, 0.25);
}

.apikey-item.add-item:hover {
  border-color: rgba(16, 185, 129, 0.5);
  background: rgba(16, 185, 129, 0.05);
}

/* API Key 子节点容器 */
.tree-node > .tree-children > .tree-node > .tree-children {
  margin-left: 20px;
  margin-top: 12px;
  padding-left: 14px;
  border-left: 2px solid rgba(16, 185, 129, 0.2);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ========== Model 卡片样式 ========== */
.model-item {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(167, 139, 250, 0.06) 100%);
  border: 1px solid rgba(139, 92, 246, 0.2);
  border-radius: 10px;
  padding: 10px 14px !important;
  transition: all 0.2s ease;
}

.model-item:hover {
  border-color: rgba(139, 92, 246, 0.35);
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.1);
}

.model-item .tree-label {
  color: var(--primary-purple);
  font-size: 13px;
}

.model-item .tree-icon {
  font-size: 15px;
}

.model-item.add-item {
  background: transparent;
  border: 2px dashed rgba(139, 92, 246, 0.2);
}

.model-item.add-item:hover {
  border-color: rgba(139, 92, 246, 0.4);
  background: rgba(139, 92, 246, 0.05);
}

.protocol-select {
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  margin-left: 10px;
  font-family: var(--font-mono);
  cursor: pointer;
  transition: all 0.2s ease;
}

.protocol-select:hover {
  border-color: var(--primary-purple);
}

.protocol-select:focus {
  outline: none;
  border-color: var(--primary-purple);
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15);
}

/* 添加项样式 */
.add-icon {
  opacity: 0.5;
  transition: all 0.3s ease;
}

.add-item:hover .add-icon {
  opacity: 1;
  transform: scale(1.1);
}

/* 搜索服务 */
.search-services {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-service-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 20px;
  background: var(--glass-bg);
  border-radius: 12px;
  border: 1px solid var(--border-color);
  backdrop-filter: blur(10px);
  transition: all 0.3s ease;
}

.search-service-item:hover {
  border-color: rgba(255, 255, 255, 0.15);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

.search-service-item.active {
  border-color: var(--primary-color);
  box-shadow: var(--shadow-glow);
  background: var(--gradient-subtle);
}

.service-info {
  display: flex;
  align-items: center;
  gap: 14px;
}

.service-icon {
  font-size: 24px;
}

.service-name {
  font-weight: 600;
  font-size: 15px;
}

.service-type {
  background: var(--gradient-subtle);
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 11px;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--primary-purple);
  letter-spacing: 0.5px;
}

.service-key {
  color: var(--text-secondary);
  font-size: 12px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
}

.service-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.active-badge {
  color: var(--primary-color);
  font-size: 13px;
  font-weight: 600;
  padding: 6px 14px;
  background: var(--primary-light);
  border-radius: 20px;
  border: 1px solid var(--border-hover);
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 50px 40px;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border-radius: 16px;
  border: 1px dashed var(--border-color);
}

.empty-state p {
  margin: 8px 0;
}

.empty-state code {
  display: block;
  margin: 6px 0;
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.hint {
  font-size: 13px;
  margin-top: 20px;
  color: var(--text-muted);
}

/* 按钮 */
.btn {
  padding: 10px 18px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-family: var(--font-display);
  font-weight: 500;
  background: var(--glass-bg);
  color: var(--text-primary);
  white-space: nowrap;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(10px);
}

.btn:hover {
  background: var(--glass-bg-light);
  border-color: var(--border-hover);
  transform: translateY(-1px);
}

.btn-primary {
  background: var(--gradient-primary);
  border: none;
  color: white;
  font-weight: 600;
}

.btn-primary:hover {
  box-shadow: var(--shadow-glow);
  filter: brightness(1.1);
}

.btn-danger {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  border: none;
  color: white;
}

.btn-danger:hover {
  box-shadow: 0 0 20px rgba(239, 68, 68, 0.3);
}

.btn-sm {
  padding: 6px 14px;
  font-size: 12px;
  border-radius: 6px;
}

.btn-icon {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border-color);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 14px;
  border-radius: 6px;
  opacity: 0.6;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tree-item:hover .btn-icon {
  opacity: 1;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: scale(1.1);
}

.btn-delete:hover {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.5);
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.2);
}

.btn-edit:hover {
  color: var(--primary-color);
  border-color: var(--border-hover);
  box-shadow: 0 0 10px rgba(124, 58, 237, 0.2);
}

/* 编辑模式样式 */
.editing {
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.12) 0%, rgba(139, 92, 246, 0.08) 100%) !important;
  border: 1px solid var(--border-hover) !important;
  border-radius: 12px;
  padding: 14px !important;
  box-shadow: var(--shadow-glow);
}

.editing.provider-item {
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.15) 0%, rgba(99, 102, 241, 0.08) 100%) !important;
}

.editing.apikey-item {
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.12) 0%, rgba(16, 185, 129, 0.06) 100%) !important;
}

.editing.model-item {
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.1) 0%, rgba(139, 92, 246, 0.06) 100%) !important;
}

.service-edit-form {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.input-select-sm {
  padding: 8px 12px;
  font-size: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-display);
}

/* 输入框 */
input, select, textarea {
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--glass-bg);
  color: var(--text-primary);
  font-size: 14px;
  font-family: var(--font-display);
  transition: all 0.3s ease;
  backdrop-filter: blur(10px);
}

input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-light);
}

input::placeholder {
  color: var(--text-muted);
}

.input-sm {
  padding: 6px 10px;
  font-size: 13px;
}

.mono {
  font-family: var(--font-mono);
}

/* 弹窗 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(5, 5, 16, 0.85);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease;
}

.modal {
  background: var(--bg-secondary);
  padding: 28px;
  border-radius: 16px;
  width: 520px;
  max-width: 90vw;
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-lg);
  animation: slideIn 0.3s ease;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.modal h3 {
  margin: 0 0 20px 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.import-options {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  color: var(--text-secondary);
  font-size: 13px;
}

.import-options input[type="file"] {
  padding: 8px;
  font-size: 12px;
}

.modal textarea {
  width: 100%;
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-deep);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  resize: vertical;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}
</style>
