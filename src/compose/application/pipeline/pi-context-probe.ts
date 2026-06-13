// pi-context-probe.ts
//
// Calls a small pi LLM agent to convert a free-form feature goal into ONE precise
// codegraph search query. The refined query is then passed to codegraph from
// arch-stage, instead of the raw goal prompt.
//
// Implementation notes:
//   * @earendil-works/pi-agent-core and @earendil-works/pi-ai are ESM-only.
//   * This project compiles to CommonJS, so the packages must be loaded via
//     dynamic import() (which Node 18+ supports natively from CJS).
//   * registerBuiltInApiProviders() is invoked exactly once across calls via a
//     module-scoped promise singleton. (The pi-ai package already calls it on
//     first import as well, but we keep our own guard for safety and clarity.)
//   * The Ollama model is built manually — getModel() cannot resolve an arbitrary
//     'ollama' provider from the static registry.
//   * On any error we fall back to the original goal prompt so the caller
//     (arch-stage) is never blocked by probe failures.

import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'

// --- ESM-only dependencies, loaded lazily via dynamic import ---------------

interface PiAgentCoreModule {
  Agent: new (options?: unknown) => Agent
}

interface PiAiModule {
  registerBuiltInApiProviders: () => void
}

let piAiModulePromise: Promise<PiAiModule> | undefined
let piAgentCoreModulePromise: Promise<PiAgentCoreModule> | undefined

function loadPiAi(): Promise<PiAiModule> {
  if (!piAiModulePromise) {
    piAiModulePromise = import('@earendil-works/pi-ai').then((m) => m as unknown as PiAiModule)
  }
  return piAiModulePromise
}

function loadPiAgentCore(): Promise<PiAgentCoreModule> {
  if (!piAgentCoreModulePromise) {
    piAgentCoreModulePromise = import('@earendil-works/pi-agent-core').then(
      (m) => m as unknown as PiAgentCoreModule,
    )
  }
  return piAgentCoreModulePromise
}

// --- Model construction -----------------------------------------------------

function buildOllamaModel(): Model<'openai-completions'> {
  const baseUrl = (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434') + '/v1'
  const id = process.env.OLLAMA_MODEL ?? 'minimax-m3:cloud'
  return {
    id,
    name: id,
    api: 'openai-completions',
    provider: 'ollama',
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 196608,
    maxTokens: 4096,
  }
}

// --- System prompt ----------------------------------------------------------

const SYSTEM_PROMPT =
  'You are a code search expert. Given a feature goal, output ONE precise search query to find the most relevant symbols, files, and architectural areas in the codebase via codegraph. Output ONLY the query string — no explanation, no quotes, no punctuation at end.'

// --- Public API -------------------------------------------------------------

/**
 * Probe a pi LLM agent to refine a free-form goal into a precise codegraph
 * search query. Falls back to the original goal on any failure.
 */
export async function probeCodegraphQuery(goalPrompt: string): Promise<string> {
  try {
    // Lazy singleton: ensure providers are registered exactly once.
    const piAi = await loadPiAi()
    piAi.registerBuiltInApiProviders()

    const piAgentCore = await loadPiAgentCore()
    const { Agent } = piAgentCore

    const model = buildOllamaModel()
    const agent = new Agent({
      initialState: {
        model,
        systemPrompt: SYSTEM_PROMPT,
      },
    })

    let accumulated = ''
    agent.subscribe((event: AgentEvent) => {
      if (event.type !== 'message_update') return
      const inner = event.assistantMessageEvent
      if (inner && inner.type === 'text_delta') {
        accumulated += inner.delta
      }
    })

    await agent.prompt(goalPrompt)

    const trimmed = accumulated.trim()
    return trimmed || goalPrompt
  } catch {
    // Graceful fallback: never block the caller on probe failures.
    return goalPrompt
  }
}
