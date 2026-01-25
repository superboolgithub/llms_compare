import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Message, ModelSelection, ComparePanel } from '../types/config'

// 聊天状态 store - 用于保持对话状态
export const useChatStore = defineStore('chat', () => {
  // 面板状态（默认1个面板）
  const comparePanels = ref<ComparePanel[]>([
    { id: '1', selection: null, messages: [], streaming: false }
  ])

  // 面板操作
  function addComparePanel() {
    const id = String(Date.now())
    comparePanels.value.push({ id, selection: null, messages: [], streaming: false })
  }

  function removeComparePanel(id: string) {
    if (comparePanels.value.length <= 1) return
    const index = comparePanels.value.findIndex(p => p.id === id)
    if (index !== -1) {
      comparePanels.value.splice(index, 1)
    }
  }

  function setComparePanelSelection(panelId: string, selection: ModelSelection) {
    const panel = comparePanels.value.find(p => p.id === panelId)
    if (panel) {
      panel.selection = selection
    }
  }

  function addComparePanelMessage(panelId: string, message: Message) {
    const panel = comparePanels.value.find(p => p.id === panelId)
    if (panel) {
      panel.messages.push(message)
    }
  }

  function updateComparePanelLastMessage(panelId: string, content: string) {
    const panel = comparePanels.value.find(p => p.id === panelId)
    if (panel && panel.messages.length > 0) {
      const lastMsg = panel.messages[panel.messages.length - 1]
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content = content
      }
    }
  }

  function setComparePanelStreaming(panelId: string, streaming: boolean) {
    const panel = comparePanels.value.find(p => p.id === panelId)
    if (panel) {
      panel.streaming = streaming
    }
  }

  function clearComparePanel(panelId: string) {
    const panel = comparePanels.value.find(p => p.id === panelId)
    if (panel) {
      panel.messages = []
    }
  }

  function clearAllComparePanels() {
    comparePanels.value.forEach(panel => {
      panel.messages = []
    })
  }

  return {
    comparePanels,
    addComparePanel,
    removeComparePanel,
    setComparePanelSelection,
    addComparePanelMessage,
    updateComparePanelLastMessage,
    setComparePanelStreaming,
    clearComparePanel,
    clearAllComparePanels
  }
})
