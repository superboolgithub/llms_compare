<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useConfigStore } from '../stores/config'
import { useChatStore } from '../stores/chat'
import { streamChat } from '../utils/api'
import { tavilySearch, serpApiSearch, formatSearchResultsForLLM, type SearchResult } from '../utils/search'
import { marked } from 'marked'
import type { ComparePanel } from '../types/config'

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

// 搜索状态
const isSearching = ref(false)

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
  const searchService = configStore.enabledSearchService
  if (!searchService) return []

  console.log('[Search] Query:', query)
  console.log('[Search] Service:', searchService.type, searchService.name)

  try {
    let response
    if (searchService.type === 'tavily') {
      response = await tavilySearch(searchService.apiKey, query, { maxResults: 5, searchDepth: 'advanced' })
    } else if (searchService.type === 'serpapi') {
      response = await serpApiSearch(searchService.apiKey, query, { maxResults: 5 })
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
const hasSearchService = computed(() => !!configStore.enabledSearchService)

// 发送消息到所有面板
async function sendToAll() {
  const text = inputText.value.trim()
  if (!text) return

  inputText.value = ''

  // 如果启用了搜索，先执行搜索
  let searchContext = ''
  if (searchEnabled.value && hasSearchService.value) {
    isSearching.value = true
    try {
      const results = await performSearch(text)
      if (results.length > 0) {
        searchContext = formatSearchResultsForLLM(results)
      }
    } finally {
      isSearching.value = false
    }
  }

  // 并行发送到所有已配置的面板
  const promises = panels.value
    .filter(panel => panel.selection && !panel.streaming)
    .map(panel => sendToPanel(panel, text, searchContext))

  await Promise.all(promises)
}

// 发送消息到单个面板
async function sendToPanel(panel: ComparePanel, text: string, searchContext: string = '') {
  const modelInfo = getPanelModel(panel)
  if (!modelInfo) return

  const { provider, apiKey, model } = modelInfo

  // 添加用户消息
  chatStore.addComparePanelMessage(panel.id, { role: 'user', content: text })

  // 重置滚动状态
  panelAutoScroll.value.set(panel.id, true)
  smartScrollPanel(panel.id)

  // 开始流式响应
  chatStore.setComparePanelStreaming(panel.id, true)
  const controller = new AbortController()
  abortControllers.value.set(panel.id, controller)

  // 添加空的助手消息
  chatStore.addComparePanelMessage(panel.id, { role: 'assistant', content: '' })

  // 构建消息列表，如果有搜索结果则添加到系统消息中
  const messagesToSend = [...panel.messages.slice(0, -1)]
  if (searchContext) {
    // 在消息开头添加搜索上下文作为系统消息
    messagesToSend.unshift({
      role: 'system',
      content: `以下是与用户问题相关的搜索结果，请参考这些信息来回答问题：\n\n${searchContext}\n\n请基于以上搜索结果和你的知识来回答用户的问题。如果搜索结果与问题相关，请引用相关信息。`
    })
  }

  await streamChat(
    provider.baseUrl,
    apiKey.key,
    model.name,
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
    model.protocol || 'openai'
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
</script>

<template>
  <div class="chat-view">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="title-group">
          <span class="title">对话比较</span>
          <span v-if="!isSinglePanel" class="panel-count">
            <span class="count-number">{{ panels.length }}</span>
            <span class="count-label">个模型</span>
          </span>
        </div>
      </div>
      <div class="toolbar-right">
        <button
          v-if="hasSearchService"
          @click="searchEnabled = !searchEnabled"
          class="btn btn-search"
          :class="{ active: searchEnabled }"
          :title="searchEnabled ? '点击关闭联网搜索' : '点击开启联网搜索'"
        >
          <span class="btn-icon">🔍</span>
          <span>{{ searchEnabled ? '搜索已开启' : '联网搜索' }}</span>
        </button>
        <button @click="addPanel" class="btn btn-add">
          <span class="btn-icon">+</span>
          <span>添加模型</span>
        </button>
        <button @click="clearAll" class="btn" :disabled="anyStreaming">
          <span class="btn-icon">🗑️</span>
          <span>清空全部</span>
        </button>
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
          <select
            class="model-select"
            :value="panel.selection ? `${panel.selection.providerId}|${panel.selection.apiKeyId}|${panel.selection.modelId}` : ''"
            @change="(e) => {
              const parts = (e.target as HTMLSelectElement).value.split('|')
              if (parts[0] && parts[1] && parts[2]) selectModel(panel.id, parts[0], parts[1], parts[2])
            }"
          >
            <option value="">选择模型...</option>
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
          <div class="panel-actions">
            <button
              v-if="panel.streaming"
              @click="stopPanel(panel.id)"
              class="btn btn-xs btn-stop"
            >
              <span class="stop-icon">■</span>
              停止
            </button>
            <button @click="clearPanel(panel.id)" class="btn btn-xs btn-ghost">清空</button>
            <button
              v-if="panels.length > 1"
              @click="removePanel(panel.id)"
              class="btn btn-xs btn-close"
            >
              ×
            </button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div
          class="panel-messages"
          :ref="(el) => setPanelRef(panel.id, el as HTMLDivElement)"
          @scroll="handlePanelScroll(panel.id)"
        >
          <div v-if="!panel.selection" class="empty-panel">
            <div class="empty-icon">🤖</div>
            <div class="empty-text">请选择模型</div>
          </div>
          <div v-else-if="panel.messages.length === 0" class="empty-panel">
            <div class="empty-icon">💬</div>
            <div class="empty-text">开始对话...</div>
          </div>
          <div
            v-for="(msg, msgIndex) in panel.messages"
            :key="msgIndex"
            class="message"
            :class="msg.role"
            :style="{ animationDelay: `${msgIndex * 0.05}s` }"
          >
            <div class="message-avatar">
              {{ msg.role === 'user' ? '👤' : '🤖' }}
            </div>
            <div
              class="message-content"
              v-html="msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content"
            ></div>
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
      <!-- 搜索状态指示 -->
      <div v-if="isSearching" class="search-status">
        <span class="search-spinner"></span>
        <span>正在搜索相关信息...</span>
      </div>
      <div v-else-if="searchEnabled && hasSearchService" class="search-status search-enabled">
        <span>🔍</span>
        <span>联网搜索已开启 - 将自动搜索相关信息</span>
      </div>
      <div class="input-container">
        <textarea
          v-model="inputText"
          :placeholder="isSinglePanel ? '输入消息... (Enter 发送)' : '输入消息，同时发送到所有面板... (Enter 发送)'"
          @keydown="handleKeydown"
          :disabled="anyStreaming || isSearching || panels.every(p => !p.selection)"
          rows="3"
        ></textarea>
        <button
          @click="sendToAll"
          class="btn btn-send"
          :disabled="anyStreaming || isSearching || !inputText.trim() || panels.every(p => !p.selection)"
        >
          <span class="send-icon">↑</span>
          <span class="send-text">{{ isSinglePanel ? '发送' : '发送到全部' }}</span>
        </button>
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

/* ===== 工具栏 ===== */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 24px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--glass-border);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 20px;
}

.title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.title {
  font-weight: 600;
  font-size: 17px;
  color: var(--text-primary);
}

.panel-count {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: var(--gradient-subtle);
  border-radius: 20px;
  border: 1px solid var(--border-hover);
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
  gap: 10px;
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

/* ===== 面板头部 ===== */
.panel-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--glass-border);
  gap: 12px;
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
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
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
  box-shadow: 0 0 0 3px var(--primary-light);
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
  padding: 18px 24px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  border-top: 1px solid var(--glass-border);
}

/* ===== 搜索状态 ===== */
.search-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  margin-bottom: 12px;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 8px;
  font-size: 13px;
  color: var(--accent-sky);
  max-width: 1200px;
  margin-left: auto;
  margin-right: auto;
}

.search-status.search-enabled {
  background: rgba(56, 189, 248, 0.05);
  border-color: rgba(56, 189, 248, 0.2);
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

.input-container {
  display: flex;
  gap: 12px;
  max-width: 1200px;
  margin: 0 auto;
}

.input-area textarea {
  flex: 1;
  resize: none;
  padding: 14px 18px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
  font-family: var(--font-sans);
  line-height: 1.6;
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
  padding: 14px 24px;
  background: var(--gradient-primary);
  border: none;
  border-radius: 12px;
  color: white;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 100px;
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
</style>
