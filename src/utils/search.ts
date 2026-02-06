// 搜索服务 API

export interface SearchResult {
  title: string
  url: string
  content: string
  score?: number
}

export interface SearchResponse {
  results: SearchResult[]
  query: string
}

// Tavily 搜索
export async function tavilySearch(
  apiKey: string,
  query: string,
  options?: {
    maxResults?: number
    searchDepth?: 'basic' | 'advanced'
  }
): Promise<SearchResponse> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: options?.maxResults || 5,
      search_depth: options?.searchDepth || 'basic',
      include_answer: false,
      include_raw_content: false
    })
  })

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status}`)
  }

  const data = await response.json()

  return {
    query,
    results: data.results?.map((r: any) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score
    })) || []
  }
}

// SerpAPI 搜索
export async function serpApiSearch(
  apiKey: string,
  query: string,
  options?: {
    maxResults?: number
  }
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    api_key: apiKey,
    q: query,
    engine: 'google',
    num: String(options?.maxResults || 5)
  })

  const response = await fetch(`https://serpapi.com/search?${params}`)

  if (!response.ok) {
    throw new Error(`SerpAPI search failed: ${response.status}`)
  }

  const data = await response.json()

  return {
    query,
    results: data.organic_results?.slice(0, options?.maxResults || 5).map((r: any) => ({
      title: r.title,
      url: r.link,
      content: r.snippet || '',
      score: r.position ? 1 / r.position : undefined
    })) || []
  }
}

// SearXNG 搜索
export async function searxngSearch(
  baseUrl: string,
  query: string,
  options?: {
    maxResults?: number
    username?: string
    password?: string
    proxyUrl?: string  // CORS 代理地址
  }
): Promise<SearchResponse> {
  // 确保 baseUrl 有协议前缀
  let normalizedUrl = baseUrl.replace(/\/$/, '')
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = `https://${normalizedUrl}`
  }

  // 构建请求 URL
  let fetchUrl: string
  if (options?.proxyUrl) {
    // 使用 CORS 代理（生产环境）
    const proxyBase = options.proxyUrl.replace(/\/$/, '')
    fetchUrl = `${proxyBase}/search?q=${encodeURIComponent(query)}&format=json`
  } else if (import.meta.env.DEV && normalizedUrl.includes('railwaysearxng-production.up.railway.app')) {
    // 开发环境使用 Vite 代理
    fetchUrl = `/api/searxng/search?q=${encodeURIComponent(query)}&format=json`
  } else {
    // 直接请求
    fetchUrl = `${normalizedUrl}/search?q=${encodeURIComponent(query)}&format=json`
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  // 添加 Basic Auth
  if (options?.username && options?.password) {
    const auth = btoa(`${options.username}:${options.password}`)
    headers['Authorization'] = `Basic ${auth}`
  }

  const response = await fetch(fetchUrl, {
    method: 'GET',
    headers
  })

  if (!response.ok) {
    throw new Error(`SearXNG search failed: ${response.status}`)
  }

  const data = await response.json()

  return {
    query,
    results: (data.results || []).slice(0, options?.maxResults || 5).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      content: r.content || r.snippet || '',
      score: r.score
    }))
  }
}

// 格式化搜索结果为 LLM 可用的上下文
export function formatSearchResultsForLLM(results: SearchResult[]): string {
  if (results.length === 0) {
    return '未找到相关搜索结果。'
  }

  return results.map((r, i) =>
    `[${i + 1}] ${r.title}\n来源: ${r.url}\n${r.content}`
  ).join('\n\n')
}
