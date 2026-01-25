<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useConfigStore } from '../stores/config'
import { useChatStore } from '../stores/chat'
import { streamChat } from '../utils/api'
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

// 发送消息到所有面板
async function sendToAll() {
  const text = inputText.value.trim()
  if (!text) return

  inputText.value = ''

  // 并行发送到所有已配置的面板
  const promises = panels.value
    .filter(panel => panel.selection && !panel.streaming)
    .map(panel => sendToPanel(panel, text))

  await Promise.all(promises)
}

// 发送消息到单个面板
async function sendToPanel(panel: ComparePanel, text: string) {
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

  await streamChat(
    provider.baseUrl,
    apiKey.key,
    model.name,
    panel.messages.slice(0, -1),
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
</script>

<template>
  <div class="chat-view">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="title">对话</span>
        <span v-if="!isSinglePanel" class="panel-count">{{ panels.length }} 个面板</span>
      </div>
      <div class="toolbar-right">
        <button @click="addPanel" class="btn btn-sm">+ 添加模型</button>
        <button @click="clearAll" class="btn btn-sm" :disabled="anyStreaming">清空全部</button>
      </div>
    </div>

    <!-- 面板区域 -->
    <div class="panels-container">
      <div
        v-for="panel in panels"
        :key="panel.id"
        class="panel"
      >
        <!-- 面板头部 -->
        <div class="panel-header">
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
              class="btn btn-xs btn-danger"
            >
              停止
            </button>
            <button @click="clearPanel(panel.id)" class="btn btn-xs">清空</button>
            <button
              v-if="panels.length > 1"
              @click="removePanel(panel.id)"
              class="btn btn-xs btn-danger"
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
            请选择模型
          </div>
          <div v-else-if="panel.messages.length === 0" class="empty-panel">
            开始对话...
          </div>
          <div
            v-for="(msg, index) in panel.messages"
            :key="index"
            class="message"
            :class="msg.role"
          >
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
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="input-area">
      <textarea
        v-model="inputText"
        :placeholder="isSinglePanel ? '输入消息... (Enter 发送)' : '输入消息，同时发送到所有面板... (Enter 发送)'"
        @keydown="handleKeydown"
        :disabled="anyStreaming || panels.every(p => !p.selection)"
        rows="3"
      ></textarea>
      <button
        @click="sendToAll"
        class="btn btn-primary"
        :disabled="anyStreaming || !inputText.trim() || panels.every(p => !p.selection)"
      >
        {{ isSinglePanel ? '发送' : '发送到全部' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 15px;
}

.title {
  font-weight: 600;
  font-size: 16px;
}

.panel-count {
  color: var(--text-secondary);
  font-size: 13px;
}

.toolbar-right {
  display: flex;
  gap: 10px;
}

.panels-container {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-color);
  min-width: 300px;
}

.panel:last-child {
  border-right: none;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  gap: 10px;
}

.model-select {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
}

.panel-actions {
  display: flex;
  gap: 5px;
}

.panel-messages {
  flex: 1;
  overflow-y: auto;
  padding: 15px;
}

.empty-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: 14px;
}

.message {
  margin-bottom: 15px;
}

.message.user .message-content {
  background: var(--primary-color);
  color: white;
  padding: 10px 14px;
  border-radius: 10px;
  border-bottom-right-radius: 4px;
  margin-left: 20%;
  white-space: pre-wrap;
}

.message.assistant .message-content {
  background: var(--bg-secondary);
  padding: 10px 14px;
  border-radius: 10px;
  border-bottom-left-radius: 4px;
  margin-right: 20%;
  line-height: 1.6;
}

.message.assistant .message-content :deep(pre) {
  background: var(--bg-tertiary);
  padding: 10px;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 12px;
}

.message.assistant .message-content :deep(code) {
  font-family: 'Fira Code', monospace;
  font-size: 13px;
}

.message.assistant .message-content :deep(p) {
  margin: 0 0 8px 0;
}

.message.assistant .message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.streaming-indicator {
  display: flex;
  gap: 4px;
  padding: 10px;
}

.streaming-indicator .dot {
  width: 6px;
  height: 6px;
  background: var(--primary-color);
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out both;
}

.streaming-indicator .dot:nth-child(1) { animation-delay: -0.32s; }
.streaming-indicator .dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

.input-area {
  padding: 15px 20px;
  border-top: 1px solid var(--border-color);
  display: flex;
  gap: 10px;
  background: var(--bg-secondary);
}

.input-area textarea {
  flex: 1;
  resize: none;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
}

.input-area textarea:focus {
  outline: none;
  border-color: var(--primary-color);
}

.input-area textarea:disabled {
  opacity: 0.5;
}

/* 按钮样式 */
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

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--primary-color);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.btn-danger {
  background: #dc3545;
  color: white;
}

.btn-sm {
  padding: 5px 10px;
  font-size: 12px;
}

.btn-xs {
  padding: 3px 8px;
  font-size: 11px;
}
</style>
