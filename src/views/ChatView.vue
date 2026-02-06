<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useConfigStore } from '../stores/config'
import { useChatStore } from '../stores/chat'
import { streamChat, chatWithTools, searchTool } from '../utils/api'
import { tavilySearch, serpApiSearch, searxngSearch, formatSearchResultsForLLM, type SearchResult } from '../utils/search'
import { marked } from 'marked'
import type { ComparePanel, SearchService } from '../types/config'
import SettingsView from './SettingsView.vue'

const configStore = useConfigStore()
const chatStore = useChatStore()

// 使用 chatStore 中的 panels（持久化状态）
const panels = computed(() => chatStore.comparePanels)

// 输入框
const inputText = ref('')

// AbortController 映射
const abortControllers = ref<Map<string, AbortController>>(new Map())

// 消息容器引用
const panelRefs = ref<Map<string, HTMLDivElement>>(new Map())

// 每个面板的自动滚动状态
const panelAutoScroll = ref<Map<string, boolean>>(new Map())

// 搜索功能开关
const searchEnabled = ref(false)

// 配置弹窗显示状态
const showSettings = ref(false)

// 选中的搜索服务 ID
const selectedSearchServiceId = ref<string>('')

// 获取所有搜索服务
const searchServices = computed(() => configStore.searchServices || [])

// 当前选中的搜索服务
const currentSearchService = computed((): SearchService | undefined => {
  if (!selectedSearchServiceId.value) {
    return configStore.enabledSearchService
  }
  return searchServices.value.find((s: SearchService) => s.id === selectedSearchServiceId.value)
})

// 获取面板的模型信息
function getPanelModel(panel: ComparePanel) {
  if (!panel.selection) return null
  const provider = configStore.providers.find(p => p.id === panel.selection!.providerId)
  const apiKey = provider?.apiKeys.find(k => k.id === panel.selection!.apiKeyId)
  const model = apiKey?.models.find(m => m.id === panel.selection!.modelId)
  if (!provider || !apiKey || !model) return null
  return { provider, apiKey, model }
}

// 渲染 Markdown
function renderMarkdown(content: string): string {
  return marked(content) as string
}

// 智能滚动
function smartScrollPanel(panelId: string) {
  nextTick(() => {
    const container = panelRefs.value.get(panelId)
    if (!container) return

    const shouldScroll = panelAutoScroll.value.get(panelId)
    if (!shouldScroll) return

    const userMessages = container.querySelectorAll('.message.user')
    const lastUserMessage = userMessages[userMessages.length - 1] as HTMLElement

    if (!lastUserMessage) {
      container.scrollTop = container.scrollHeight
      return
    }

    const containerRect = container.getBoundingClientRect()
    const messageRect = lastUserMessage.getBoundingClientRect()
    const messageTopRelativeToContainer = messageRect.top - containerRect.top

    if (messageTopRelativeToContainer <= 10) {
      panelAutoScroll.value.set(panelId, false)
      return
    }

    container.scrollTop = container.scrollHeight
  })
}

// 处理面板滚动
function handlePanelScroll(panelId: string) {
  const panel = panels.value.find(p => p.id === panelId)
  if (!panel?.streaming) return

  const container = panelRefs.value.get(panelId)
  if (!container) return

  const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50
  if (!isAtBottom) {
    panelAutoScroll.value.set(panelId, false)
  }
}

// 添加面板
function addPanel() {
  chatStore.addComparePanel()
}

// 移除面板
function removePanel(id: string) {
  if (panels.value.length <= 1) return
  // 停止该面板的流式请求
  abortControllers.value.get(id)?.abort()
  abortControllers.value.delete(id)
  chatStore.removeComparePanel(id)
}

// 选择模型
function selectModel(panelId: string, providerId: string, apiKeyId: string, modelId: string) {
  chatStore.setComparePanelSelection(panelId, { providerId, apiKeyId, modelId })
}

// 执行搜索
async function performSearch(query: string): Promise<SearchResult[]> {
  console.log('[Search] selectedSearchServiceId:', selectedSearchServiceId.value)
  console.log('[Search] searchServices:', searchServices.value.map(s => ({ id: s.id, name: s.name, type: s.type })))

  const searchService = currentSearchService.value
  if (!searchService) {
    console.log('[Search] No search service configured')
    return []
  }

  console.log('[Search] Query:', query)
  console.log('[Search] Service:', searchService.type, searchService.name)
  console.log('[Search] BaseUrl:', searchService.baseUrl)
  console.log('[Search] Full service config:', JSON.stringify(searchService))

  try {
    let response
    if (searchService.type === 'tavily') {
      response = await tavilySearch(searchService.apiKey, query, { maxResults: 5, searchDepth: 'advanced' })
    } else if (searchService.type === 'serpapi') {
      response = await serpApiSearch(searchService.apiKey, query, { maxResults: 5 })
    } else if (searchService.type === 'searxng') {
      response = await searxngSearch(searchService.baseUrl || '', query, {
        maxResults: 5,
        username: searchService.username,
        password: searchService.apiKey,
        proxyUrl: searchService.proxyUrl
      })
    } else {
      return []
    }
    console.log('[Search] Results:', response.results)
    return response.results
  } catch (error) {
    console.error('Search failed:', error)
    return []
  }
}

// 是否有可用的搜索服务
const hasSearchService = computed(() => searchServices.value.length > 0)

// 搜索状态映射（每个面板独立）
const panelSearchStatus = ref<Map<string, string>>(new Map())

// 发送消息到所有面板
async function sendToAll() {
  const text = inputText.value.trim()
  if (!text) return

  inputText.value = ''

  // 并行发送到所有已配置的面板（每个面板独立决定是否搜索）
  const promises = panels.value
    .filter(panel => canPanelSend(panel) && !panel.streaming)
    .map(panel => sendToPanel(panel, text))

  await Promise.all(promises)
}

// 发送消息到单个面板（支持 LLM 决策搜索）
async function sendToPanel(panel: ComparePanel, text: string) {
  // 获取 API 配置（优先使用临时配置）
  let baseUrl: string
  let apiKey: string
  let modelName: string
  let protocol: 'openai' | 'anthropic' | 'gemini' = 'openai'

  if (panel.tempApi) {
    baseUrl = panel.tempApi.baseUrl
    apiKey = panel.tempApi.apiKey
    modelName = panel.tempApi.model
  } else {
    const modelInfo = getPanelModel(panel)
    if (!modelInfo) return
    baseUrl = modelInfo.provider.baseUrl
    apiKey = modelInfo.apiKey.key
    modelName = modelInfo.model.name
    protocol = modelInfo.model.protocol || 'openai'
  }

  // 添加用户消息
  chatStore.addComparePanelMessage(panel.id, { role: 'user', content: text })

  // 重置滚动状态
  panelAutoScroll.value.set(panel.id, true)
  smartScrollPanel(panel.id)

  // 如果启用了搜索且有搜索服务，使用 Tool Use 让 LLM 决定是否搜索
  let searchContext = ''
  console.log(`[Panel ${panel.id}] Search enabled: ${searchEnabled.value}, hasSearchService: ${hasSearchService.value}, protocol: ${protocol}`)

  if (searchEnabled.value && hasSearchService.value) {
    // 对于支持 Tool Use 的协议，让 LLM 决定是否搜索
    if (protocol === 'openai' || protocol === 'anthropic') {
      try {
        panelSearchStatus.value.set(panel.id, '正在分析是否需要搜索...')

        // 构建消息，让 LLM 判断是否需要搜索
        const messagesForToolUse = [
          ...panel.messages.slice(0, -1), // 不包括刚添加的用户消息（因为还没在 store 里）
          { role: 'user' as const, content: text }
        ]

        console.log(`[Panel ${panel.id}] Calling chatWithTools...`)
        const toolResult = await chatWithTools(
          baseUrl,
          apiKey,
          modelName,
          messagesForToolUse,
          [searchTool],
          protocol
        )
        console.log(`[Panel ${panel.id}] Tool result:`, JSON.stringify(toolResult))

        // 检查是否需要搜索
        if (toolResult.toolCalls && toolResult.toolCalls.length > 0) {
          for (const toolCall of toolResult.toolCalls) {
            if (toolCall.function.name === 'web_search') {
              const args = JSON.parse(toolCall.function.arguments)
              const searchQuery = args.query

              panelSearchStatus.value.set(panel.id, `搜索: ${searchQuery}`)
              console.log(`[Panel ${panel.id}] LLM decided to search:`, searchQuery)

              const results = await performSearch(searchQuery)
              console.log(`[Panel ${panel.id}] Search results count:`, results.length)
              if (results.length > 0) {
                searchContext = formatSearchResultsForLLM(results)
                console.log(`[Panel ${panel.id}] Formatted searchContext length:`, searchContext.length)
              }
            }
          }
        } else {
          console.log(`[Panel ${panel.id}] LLM decided not to search, toolCalls:`, toolResult.toolCalls)
        }
      } catch (error) {
        console.error(`[Panel ${panel.id}] Tool use failed, falling back to direct search:`, error)
        // Tool use 失败时，回退到直接搜索（用用户原始问题）
        panelSearchStatus.value.set(panel.id, `搜索: ${text}`)
        const results = await performSearch(text)
        console.log(`[Panel ${panel.id}] Fallback search results count:`, results.length)
        if (results.length > 0) {
          searchContext = formatSearchResultsForLLM(results)
          console.log(`[Panel ${panel.id}] Fallback searchContext length:`, searchContext.length)
        }
      } finally {
        panelSearchStatus.value.delete(panel.id)
      }
    } else {
      // 对于不支持 Tool Use 的协议（如 Gemini），直接搜索
      console.log(`[Panel ${panel.id}] Protocol ${protocol} doesn't support Tool Use, using direct search`)
      panelSearchStatus.value.set(panel.id, `搜索: ${text}`)
      const results = await performSearch(text)
      console.log(`[Panel ${panel.id}] Direct search results count:`, results.length)
      if (results.length > 0) {
        searchContext = formatSearchResultsForLLM(results)
        console.log(`[Panel ${panel.id}] Direct searchContext length:`, searchContext.length)
      }
      panelSearchStatus.value.delete(panel.id)
    }
  }
  smartScrollPanel(panel.id)

  // 开始流式响应
  chatStore.setComparePanelStreaming(panel.id, true)
  const controller = new AbortController()
  abortControllers.value.set(panel.id, controller)

  // 添加空的助手消息
  chatStore.addComparePanelMessage(panel.id, { role: 'assistant', content: '' })

  // 构建消息列表，如果有搜索结果则添加到系统消息中
  const messagesToSend = [...panel.messages.slice(0, -1)]

  console.log(`[Panel ${panel.id}] searchContext length:`, searchContext.length)
  console.log(`[Panel ${panel.id}] searchContext:`, searchContext.substring(0, 200))

  if (searchContext) {
    // 在消息开头添加搜索上下文作为系统消息
    messagesToSend.unshift({
      role: 'system',
      content: `以下是与用户问题相关的搜索结果，请参考这些信息来回答问题：\n\n${searchContext}\n\n请基于以上搜索结果和你的知识来回答用户的问题。如果搜索结果与问题相关，请引用相关信息。`
    })
    console.log(`[Panel ${panel.id}] Added search context to messages`)
  }

  console.log(`[Panel ${panel.id}] Final messages to send:`, messagesToSend.length, 'messages')

  await streamChat(
    baseUrl,
    apiKey,
    modelName,
    messagesToSend,
    {
      onChunk: (chunk) => {
        const lastMsg = panel.messages[panel.messages.length - 1]
        if (lastMsg) {
          chatStore.updateComparePanelLastMessage(panel.id, lastMsg.content + chunk)
        }
        smartScrollPanel(panel.id)
      },
      onDone: () => {
        chatStore.setComparePanelStreaming(panel.id, false)
        abortControllers.value.delete(panel.id)
      },
      onError: (error) => {
        chatStore.updateComparePanelLastMessage(panel.id, `错误: ${error.message}`)
        chatStore.setComparePanelStreaming(panel.id, false)
        abortControllers.value.delete(panel.id)
      }
    },
    controller.signal,
    protocol
  )
}

// 停止面板生成
function stopPanel(panelId: string) {
  abortControllers.value.get(panelId)?.abort()
}

// 清空面板对话
function clearPanel(panelId: string) {
  chatStore.clearComparePanel(panelId)
}

// 清空所有面板
function clearAll() {
  chatStore.clearAllComparePanels()
}

// 处理输入框回车
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendToAll()
  }
}

// 是否有任何面板在流式输出
const anyStreaming = computed(() => panels.value.some(p => p.streaming))

// 是否单面板模式
const isSinglePanel = computed(() => panels.value.length === 1)

// 设置面板引用
function setPanelRef(panelId: string, el: HTMLDivElement | null) {
  if (el) {
    panelRefs.value.set(panelId, el)
  } else {
    panelRefs.value.delete(panelId)
  }
}

// 获取面板索引对应的颜色
function getPanelColor(index: number) {
  const colors = ['indigo', 'violet', 'sky', 'emerald', 'rose']
  return colors[index % colors.length]
}

// 临时 API 配置
interface TempApiConfig {
  baseUrl: string
  apiKey: string
  model: string
}
const tempApiConfigs = ref<Map<string, TempApiConfig>>(new Map())
const showTempInput = ref<Map<string, boolean>>(new Map())

// 切换临时输入显示
function toggleTempInput(panelId: string) {
  const current = showTempInput.value.get(panelId) || false
  showTempInput.value.set(panelId, !current)
  if (!tempApiConfigs.value.has(panelId)) {
    tempApiConfigs.value.set(panelId, { baseUrl: '', apiKey: '', model: '' })
  }
}

// 使用临时 API
function useTempApi(panelId: string) {
  const config = tempApiConfigs.value.get(panelId)
  if (!config?.baseUrl || !config?.apiKey || !config?.model) return

  // 设置为临时模式
  chatStore.setComparePanelTempApi(panelId, config)
  showTempInput.value.set(panelId, false)
}

// 检查面板是否可以发送
function canPanelSend(panel: ComparePanel): boolean {
  return !!(panel.selection || panel.tempApi)
}
</script>

<template>
  <div class="chat-view">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="title">LLM Compare</span>
        <span v-if="!isSinglePanel" class="panel-count">{{ panels.length }}</span>
      </div>
      <div class="toolbar-right">
        <button @click="addPanel" class="btn btn-sm">+ 添加</button>
        <button @click="clearAll" class="btn btn-sm" :disabled="anyStreaming">清空</button>
        <button @click="showSettings = true" class="btn btn-sm btn-settings" title="设置">⚙️</button>
      </div>
    </div>

    <!-- 面板区域 -->
    <div class="panels-container">
      <div
        v-for="(panel, index) in panels"
        :key="panel.id"
        class="panel"
        :class="[`panel-${getPanelColor(index)}`, { streaming: panel.streaming }]"
      >
        <!-- 面板头部 -->
        <div class="panel-header">
          <div class="panel-indicator" :class="`indicator-${getPanelColor(index)}`"></div>

          <!-- 模型选择或临时输入 -->
          <div class="model-selector">
            <select
              v-if="!showTempInput.get(panel.id)"
              class="model-select"
              :value="panel.selection ? `${panel.selection.providerId}|${panel.selection.apiKeyId}|${panel.selection.modelId}` : (panel.tempApi ? 'temp' : '')"
              @change="(e) => {
                const val = (e.target as HTMLSelectElement).value
                if (val === 'temp') return
                const parts = val.split('|')
                if (parts[0] && parts[1] && parts[2]) {
                  chatStore.clearComparePanelTempApi(panel.id)
                  selectModel(panel.id, parts[0], parts[1], parts[2])
                }
              }"
            >
              <option value="">选择模型...</option>
              <option v-if="panel.tempApi" value="temp">临时: {{ panel.tempApi.model }}</option>
              <optgroup
                v-for="provider in configStore.providers"
                :key="provider.id"
                :label="provider.name"
              >
                <template v-for="apiKey in provider.apiKeys" :key="apiKey.id">
                  <option
                    v-for="model in apiKey.models.filter(m => m.enabled)"
                    :key="model.id"
                    :value="`${provider.id}|${apiKey.id}|${model.id}`"
                  >
                    {{ apiKey.name }} / {{ model.name }}
                  </option>
                </template>
              </optgroup>
            </select>

            <!-- 临时 API 输入 -->
            <div v-if="showTempInput.get(panel.id)" class="temp-api-form">
              <input
                v-model="tempApiConfigs.get(panel.id)!.baseUrl"
                placeholder="Base URL"
                class="temp-input"
              />
              <input
                v-model="tempApiConfigs.get(panel.id)!.apiKey"
                placeholder="API Key"
                type="password"
                class="temp-input"
              />
              <input
                v-model="tempApiConfigs.get(panel.id)!.model"
                placeholder="Model"
                class="temp-input"
              />
              <button @click="useTempApi(panel.id)" class="btn btn-xs btn-primary">确定</button>
            </div>

            <button
              @click="toggleTempInput(panel.id)"
              class="btn btn-xs btn-temp"
              :title="showTempInput.get(panel.id) ? '取消' : '临时API'"
            >
              {{ showTempInput.get(panel.id) ? '×' : '⚡' }}
            </button>
          </div>

          <div class="panel-actions">
            <button
              v-if="panel.streaming"
              @click="stopPanel(panel.id)"
              class="btn btn-xs btn-stop"
            >■</button>
            <button @click="clearPanel(panel.id)" class="btn btn-xs btn-ghost">清</button>
            <button
              v-if="panels.length > 1"
              @click="removePanel(panel.id)"
              class="btn btn-xs btn-close"
            >×</button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div
          class="panel-messages"
          :ref="(el) => setPanelRef(panel.id, el as HTMLDivElement)"
          @scroll="handlePanelScroll(panel.id)"
        >
          <div v-if="!canPanelSend(panel)" class="empty-panel">
            <div class="empty-icon">🤖</div>
            <div class="empty-text">选择模型或输入临时API</div>
          </div>
          <div v-else-if="panel.messages.length === 0" class="empty-panel">
            <div class="empty-icon">💬</div>
            <div class="empty-text">开始对话</div>
          </div>
          <div
            v-for="(msg, msgIndex) in panel.messages"
            :key="msgIndex"
            class="message"
            :class="msg.role"
          >
            <div class="message-avatar">
              {{ msg.role === 'user' ? '👤' : '🤖' }}
            </div>
            <div
              class="message-content"
              v-html="msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content"
            ></div>
          </div>
          <div v-if="panelSearchStatus.get(panel.id)" class="panel-search-status">
            <span class="search-spinner"></span>
            <span>{{ panelSearchStatus.get(panel.id) }}</span>
          </div>
          <div v-if="panel.streaming" class="streaming-indicator">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </div>
        </div>

        <!-- 面板底部发光线 -->
        <div v-if="panel.streaming" class="panel-glow-line" :class="`glow-${getPanelColor(index)}`"></div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="input-area">
      <div class="input-container">
        <textarea
          v-model="inputText"
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          @keydown="handleKeydown"
          :disabled="anyStreaming || panels.every(p => !canPanelSend(p))"
          rows="2"
        ></textarea>

        <!-- 搜索按钮组 -->
        <div class="search-toggle" v-if="hasSearchService">
          <button
            @click="searchEnabled = !searchEnabled"
            class="btn btn-search-icon"
            :class="{ active: searchEnabled }"
            :title="searchEnabled ? '关闭智能搜索' : '开启智能搜索'"
          >
            🌐
          </button>
          <select
            v-if="searchEnabled && searchServices.length > 1"
            v-model="selectedSearchServiceId"
            class="search-select"
          >
            <option value="">默认</option>
            <option v-for="s in searchServices" :key="s.id" :value="s.id">
              {{ s.name }}
            </option>
          </select>
        </div>

        <button
          @click="sendToAll"
          class="btn btn-send"
          :disabled="anyStreaming || !inputText.trim() || panels.every(p => !canPanelSend(p))"
        >
          <span class="send-icon">↑</span>
        </button>
      </div>
    </div>

    <!-- 设置弹窗 -->
    <div v-if="showSettings" class="settings-overlay" @click.self="showSettings = false">
      <div class="settings-modal">
        <div class="settings-header">
          <h2>设置</h2>
          <button @click="showSettings = false" class="btn-close-modal">×</button>
        </div>
        <div class="settings-content">
          <SettingsView />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

/* ===== 工具栏 - 紧凑版 ===== */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.panel-count {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--gradient-subtle);
  border-radius: 12px;
  border: 1px solid var(--border-hover);
  font-size: 12px;
  color: var(--accent-violet);
}

.count-number {
  font-weight: 600;
  font-size: 14px;
  color: var(--accent-violet);
}

.count-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.toolbar-right {
  display: flex;
  gap: 6px;
}

.btn-add {
  background: var(--gradient-subtle);
  border: 1px solid var(--border-hover);
}

.btn-add:hover {
  background: var(--primary-light);
  box-shadow: var(--shadow-glow);
}

/* ===== 搜索按钮 ===== */
.btn-search {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  transition: all 0.2s ease;
}

.btn-search:hover {
  border-color: var(--accent-sky);
  background: rgba(56, 189, 248, 0.1);
}

.btn-search.active {
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%);
  border-color: var(--accent-sky);
  color: var(--accent-sky);
}

.btn-icon {
  margin-right: 6px;
}

/* ===== 面板容器 ===== */
.panels-container {
  flex: 1;
  display: flex;
  overflow: hidden;
  gap: 1px;
  background: var(--border-color);
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  min-width: 320px;
  position: relative;
  transition: all 0.2s ease;
}

.panel.streaming {
  box-shadow: inset 0 0 40px rgba(124, 58, 237, 0.05);
}

/* 面板颜色变体 */
.panel-indigo .panel-header { border-left: 3px solid var(--primary-blue); }
.panel-violet .panel-header { border-left: 3px solid var(--primary-purple); }
.panel-sky .panel-header { border-left: 3px solid var(--accent-sky); }
.panel-emerald .panel-header { border-left: 3px solid #10b981; }
.panel-rose .panel-header { border-left: 3px solid #f43f5e; }

/* ===== 面板头部 - 紧凑版 ===== */
.panel-header {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--glass-border);
  gap: 8px;
  flex-shrink: 0;
}

.panel-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.indicator-indigo { background: var(--primary-blue); }
.indicator-violet { background: var(--primary-purple); }
.indicator-sky { background: var(--accent-sky); }
.indicator-emerald { background: #10b981; }
.indicator-rose { background: #f43f5e; }

.model-select {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: all 0.2s ease;
}

.model-select:hover {
  border-color: var(--border-hover);
}

.model-select:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px var(--primary-light);
}

.model-selector {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ===== 临时 API 表单 ===== */
.temp-api-form {
  flex: 1;
  display: flex;
  gap: 4px;
  align-items: center;
}

.temp-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 11px;
  min-width: 60px;
}

.temp-input:focus {
  outline: none;
  border-color: var(--primary-color);
}

.btn-temp {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  padding: 4px 8px;
  font-size: 12px;
}

.btn-temp:hover {
  background: var(--accent-sky);
  color: white;
  border-color: var(--accent-sky);
}

.btn-xs {
  padding: 4px 8px;
  font-size: 11px;
  border-radius: 4px;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 6px;
}

.btn-primary {
  background: var(--gradient-primary);
  border: none;
  color: white;
}

.panel-actions {
  display: flex;
  gap: 6px;
}

.btn-ghost {
  background: transparent;
  border: 1px solid var(--border-color);
}

.btn-ghost:hover {
  background: var(--glass-bg-light);
  border-color: var(--text-secondary);
}

.btn-stop {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  border: none;
  color: white;
}

.stop-icon {
  font-size: 8px;
  margin-right: 4px;
}

.btn-close {
  background: transparent;
  border: 1px solid var(--border-color);
  width: 24px;
  height: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--text-secondary);
}

.btn-close:hover {
  background: rgba(244, 63, 94, 0.15);
  border-color: #f43f5e;
  color: #f43f5e;
}

/* ===== 消息列表 ===== */
.panel-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
}

.empty-icon {
  font-size: 48px;
  opacity: 0.4;
}

.empty-text {
  color: var(--text-muted);
  font-size: 14px;
}

/* ===== 消息样式 ===== */
.message {
  display: flex;
  gap: 12px;
  animation: slideUp 0.3s ease-out forwards;
  opacity: 0;
}

.message-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
  background: var(--bg-tertiary);
  border: 1px solid var(--glass-border);
}

.message.user {
  flex-direction: row-reverse;
}

.message.user .message-avatar {
  background: var(--gradient-primary);
  border: none;
}

.message.user .message-content {
  background: var(--gradient-subtle);
  border: 1px solid var(--border-hover);
  border-radius: 16px 16px 4px 16px;
  margin-left: 15%;
}

.message.assistant .message-content {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 16px 16px 16px 4px;
  margin-right: 15%;
}

.message-content {
  padding: 14px 18px;
  line-height: 1.7;
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Markdown 样式 */
.message.assistant .message-content :deep(pre) {
  background: var(--bg-base);
  padding: 14px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13px;
  margin: 12px 0;
  border: 1px solid var(--border-color);
}

.message.assistant .message-content :deep(code) {
  font-family: var(--font-mono);
  font-size: 13px;
}

.message.assistant .message-content :deep(p) {
  margin: 0 0 12px 0;
}

.message.assistant .message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message.assistant .message-content :deep(ul),
.message.assistant .message-content :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.message.assistant .message-content :deep(li) {
  margin: 4px 0;
}

.message.assistant .message-content :deep(h1),
.message.assistant .message-content :deep(h2),
.message.assistant .message-content :deep(h3) {
  margin: 16px 0 8px 0;
  color: var(--text-primary);
}

.message.assistant .message-content :deep(blockquote) {
  border-left: 3px solid var(--primary-purple);
  margin: 12px 0;
  padding-left: 16px;
  color: var(--text-secondary);
}

/* ===== 流式指示器 ===== */
.panel-search-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  margin: 8px 16px;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 8px;
  font-size: 12px;
  color: var(--accent-sky);
}

.search-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(56, 189, 248, 0.3);
  border-top-color: var(--accent-sky);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.streaming-indicator {
  display: flex;
  gap: 6px;
  padding: 12px 18px;
  align-self: flex-start;
}

.streaming-indicator .dot {
  width: 8px;
  height: 8px;
  background: var(--gradient-primary);
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out both;
}

.streaming-indicator .dot:nth-child(1) { animation-delay: -0.32s; }
.streaming-indicator .dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ===== 面板发光线 ===== */
.panel-glow-line {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  animation: pulse 2s ease-in-out infinite;
}

.glow-indigo { background: linear-gradient(90deg, transparent, var(--primary-blue), transparent); }
.glow-violet { background: linear-gradient(90deg, transparent, var(--primary-purple), transparent); }
.glow-sky { background: linear-gradient(90deg, transparent, var(--accent-sky), transparent); }
.glow-emerald { background: linear-gradient(90deg, transparent, #10b981, transparent); }
.glow-rose { background: linear-gradient(90deg, transparent, #f43f5e, transparent); }

/* ===== 输入区域 ===== */
.input-area {
  padding: 10px 16px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  border-top: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.input-container {
  display: flex;
  gap: 8px;
  align-items: center;
  max-width: 1200px;
  margin: 0 auto;
}

.input-area textarea {
  flex: 1;
  resize: none;
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
  font-family: var(--font-sans);
  line-height: 1.5;
  transition: all 0.2s ease;
}

.input-area textarea:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.input-area textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-area textarea::placeholder {
  color: var(--text-muted);
}

.btn-send {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px 20px;
  background: var(--gradient-primary);
  border: none;
  border-radius: 10px;
  color: white;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 60px;
}

.btn-send:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: var(--shadow-glow);
  filter: brightness(1.1);
}

.btn-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}

.send-icon {
  font-size: 20px;
  font-weight: 700;
}

.send-text {
  font-size: 11px;
  margin-top: 2px;
}

/* ===== 设置按钮 ===== */
.btn-settings {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
}

.btn-settings:hover {
  background: var(--bg-tertiary);
  border-color: var(--border-hover);
}

/* ===== 搜索按钮组 ===== */
.search-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-search-icon {
  width: 40px;
  height: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  opacity: 0.6;
}

.btn-search-icon:hover {
  opacity: 1;
  border-color: var(--accent-sky);
}

.btn-search-icon.active {
  opacity: 1;
  background: rgba(56, 189, 248, 0.15);
  border-color: var(--accent-sky);
  color: var(--accent-sky);
}

.search-select {
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  max-width: 100px;
}

/* ===== 设置弹窗 ===== */
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-modal {
  width: 90%;
  max-width: 900px;
  max-height: 90vh;
  background: var(--bg-primary);
  border-radius: 16px;
  border: 1px solid var(--glass-border);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--glass-border);
  background: var(--glass-bg);
}

.settings-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.btn-close-modal {
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-close-modal:hover {
  background: rgba(244, 63, 94, 0.1);
  border-color: #f43f5e;
  color: #f43f5e;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.settings-content > * {
  height: 100%;
}
</style>
