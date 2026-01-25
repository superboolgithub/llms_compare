import type { Message, ApiProtocol } from '../types/config'

export interface StreamCallbacks {
  onChunk: (chunk: string) => void
  onDone: () => void
  onError: (error: Error) => void
}

// OpenAI 协议
async function streamOpenAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Message[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const url = `${baseUrl}/chat/completions`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true
    }),
    signal
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API Error ${response.status}: ${errorText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]') continue
      if (!trimmed.startsWith('data: ')) continue

      try {
        const json = JSON.parse(trimmed.slice(6))
        const content = json.choices?.[0]?.delta?.content
        if (content) {
          callbacks.onChunk(content)
        }
      } catch {
        // 忽略解析错误
      }
    }
  }
}

// Anthropic 协议
async function streamAnthropic(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Message[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const url = `${baseUrl}/v1/messages`

  // 转换消息格式：提取 system 消息
  const systemMsg = messages.find(m => m.role === 'system')
  const chatMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }))

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemMsg?.content,
      messages: chatMessages,
      stream: true
    }),
    signal
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API Error ${response.status}: ${errorText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue

      try {
        const json = JSON.parse(trimmed.slice(6))
        if (json.type === 'content_block_delta' && json.delta?.text) {
          callbacks.onChunk(json.delta.text)
        }
      } catch {
        // 忽略解析错误
      }
    }
  }
}

// Gemini 协议
async function streamGemini(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Message[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const url = `${baseUrl}/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`

  // 转换消息格式
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))

  const systemInstruction = messages.find(m => m.role === 'system')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents,
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction.content }] } : undefined
    }),
    signal
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API Error ${response.status}: ${errorText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue

      try {
        const json = JSON.parse(trimmed.slice(6))
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) {
          callbacks.onChunk(text)
        }
      } catch {
        // 忽略解析错误
      }
    }
  }
}

// 统一入口
export async function streamChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Message[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  protocol: ApiProtocol = 'openai'
): Promise<void> {
  try {
    switch (protocol) {
      case 'anthropic':
        await streamAnthropic(baseUrl, apiKey, model, messages, callbacks, signal)
        break
      case 'gemini':
        await streamGemini(baseUrl, apiKey, model, messages, callbacks, signal)
        break
      case 'openai':
      default:
        await streamOpenAI(baseUrl, apiKey, model, messages, callbacks, signal)
        break
    }
    callbacks.onDone()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      callbacks.onDone()
    } else {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

// 非流式请求（用于获取模型列表等）
export async function fetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${baseUrl}/models`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`)
    }

    const data = await response.json()
    return data.data?.map((m: { id: string }) => m.id) || []
  } catch (error) {
    console.error('Failed to fetch models:', error)
    return []
  }
}
