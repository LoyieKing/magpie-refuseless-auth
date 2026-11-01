const PROVIDER = "refuseless"
const BASE = "https://api.refuseless.com/v1"
const KEYS_URL = "https://refuseless.com/console/api-keys"
const CLIENT = "magpie-refuseless-auth/0.1.0"

// What the catalog said on 2026-11-01. The models hook replaces this with the
// account's live list; these keep the picker useful before anyone signs in and
// when the catalog is unreachable.
const CATALOG = {
  "glm-5.3-abliterated": {
    name: "GLM 5.3 Abliterated",
    context: 1048576,
    output: 131072,
    input: ["text"],
    cost: { input: 1, output: 2, cache_read: 0.15 },
  },
  "glm-5.3-flash-abliterated": {
    name: "GLM 5.3 Flash Abliterated",
    context: 1048576,
    output: 131072,
    input: ["text", "image"],
    cost: { input: 0.12, output: 0.5, cache_read: 0.04 },
  },
  "deepseek-v4.1-flash-abliterated": {
    name: "DeepSeek V4.1 Flash Abliterated",
    context: 1048576,
    output: 130000,
    input: ["text"],
    cost: { input: 0.14, output: 0.5, cache_read: 0.035 },
  },
  "deepseek-v4.1-flash-fast": {
    name: "DeepSeek V4.1 Flash Fast",
    context: 1048576,
    output: 1048576,
    input: ["text"],
    cost: { input: 0.05, output: 0.15, cache_read: 0.003 },
  },
  "minimax-m3.1-flash": {
    name: "MiniMax M3.1 Flash",
    context: 1048576,
    output: 512000,
    input: ["text"],
    cost: { input: 0.05, output: 0.25, cache_read: 0.002 },
  },
}

const DEFAULT_EFFORTS = ["low", "high", "max"]

function apiKeyOf(auth) {
  return auth?.type === "api" && typeof auth.key === "string" ? auth.key.trim() : ""
}

function positiveInt(v) {
  return Number.isInteger(v) && v > 0 ? v : 0
}

function inputKinds(id, live, base) {
  const known = CATALOG[id]?.input
  if (known) return known
  const said = base?.capabilities?.input
  if (said && typeof said === "object") {
    const kinds = Object.keys(said).filter((k) => said[k] === true)
    if (kinds.length) return kinds
  }
  return ["text"]
}

function costOf(id, base) {
  const known = CATALOG[id]?.cost
  if (known) return { input: known.input, output: known.output, cache: { read: known.cache_read, write: 0 } }
  const c = base?.cost
  return {
    input: Number.isFinite(c?.input) ? c.input : 0,
    output: Number.isFinite(c?.output) ? c.output : 0,
    cache: { read: Number.isFinite(c?.cache?.read) ? c.cache.read : 0, write: Number.isFinite(c?.cache?.write) ? c.cache.write : 0 },
  }
}

function effortsOf(live, base) {
  const list = Array.isArray(live?.reasoning_efforts)
    ? live.reasoning_efforts
    : Array.isArray(base?.variants)
      ? base.variants
      : Object.keys(base?.variants ?? {})
  const out = []
  for (const e of list) {
    if (typeof e !== "string") continue
    const level = e.trim().toLowerCase()
    if (level && !out.includes(level)) out.push(level)
  }
  return out
}

const BRANDS = { glm: "GLM", deepseek: "DeepSeek", minimax: "MiniMax" }

function prettyName(id) {
  return id
    .replace(/-abliterated$/, " Abliterated")
    .split("-")
    .map((w) => {
      const brand = BRANDS[w.toLowerCase()]
      if (brand) return brand
      if (/^v\d/.test(w)) return w.toUpperCase()
      return w[0].toUpperCase() + w.slice(1)
    })
    .join(" ")
}

function modelOf(id, live, base) {
  const known = CATALOG[id]
  const efforts = effortsOf(live, base)
  const context = positiveInt(live?.context_length) || positiveInt(base?.limit?.context) || known?.context || 1048576
  const output = known?.output || positiveInt(base?.limit?.output) || 131072
  const input = inputKinds(id, live, base)
  const image = input.includes("image")
  return {
    ...(base ?? {}),
    id,
    name: known?.name || (typeof live?.name === "string" && live.name.trim()) || base?.name || prettyName(id),
    limit: { context, output },
    cost: costOf(id, base),
    variants: Object.fromEntries(efforts.map((e) => [e, {}])),
    capabilities: {
      ...(base?.capabilities ?? {}),
      reasoning: efforts.length > 0,
      toolcall: true,
      attachment: image,
      input: { text: true, image },
      output: { text: true },
    },
  }
}

function configModels() {
  return Object.fromEntries(
    Object.entries(CATALOG).map(([id, m]) => [
      id,
      {
        name: m.name,
        limit: { context: m.context, output: m.output },
        reasoning: true,
        tool_call: true,
        modalities: { input: m.input },
        cost: { input: m.cost.input, output: m.cost.output, cache_read: m.cost.cache_read },
        variants: Object.fromEntries(DEFAULT_EFFORTS.map((e) => [e, {}])),
      },
    ]),
  )
}

function usd(n) {
  if (!Number.isFinite(n)) return ""
  let s = Math.max(0, n)
    .toFixed(6)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
  if (!s.includes(".")) s += ".00"
  else if (s.split(".")[1].length === 1) s += "0"
  return `$${s}`
}

function expired(message) {
  return Object.assign(new Error(message), { signIn: "expired" })
}

async function getJSON(url, key, signal) {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${key}`, accept: "application/json", "user-agent": CLIENT },
    ...(signal ? { signal } : {}),
  })
  return { res, body: await res.json().catch(() => null) }
}

const Refuseless = async () => ({
  config: async (cfg) => {
    cfg.provider ??= {}
    cfg.provider[PROVIDER] ??= {
      name: "Refuseless",
      npm: "@ai-sdk/openai-compatible",
      api: BASE,
      models: configModels(),
    }
  },

  auth: {
    provider: PROVIDER,
    methods: [
      {
        type: "api",
        label: "Refuseless API key",
        placeholder: `abl_… — create one at ${KEYS_URL}`,
      },
    ],

    async loader(getAuth) {
      const auth = await getAuth()
      const key = apiKeyOf(auth)
      if (!key) return {}
      return {
        baseURL: BASE,
        apiKey: key,
        headers: { "x-refuseless-client": CLIENT },
      }
    },

    async usage(getAuth) {
      const auth = await getAuth()
      const key = apiKeyOf(auth)
      if (!key) return { error: "Sign in to Refuseless to read its credit balance.", windows: [] }

      let r
      try {
        r = await getJSON(`${BASE}/credits`, key, AbortSignal.timeout(20000))
      } catch (e) {
        return { error: `Refuseless's credit API is unreachable: ${e?.message ?? e}`, windows: [] }
      }
      if (r.res.status === 401) {
        return { error: "Refuseless rejected the API key; sign in again.", signIn: "expired", windows: [] }
      }
      if (!r.res.ok) {
        return { error: `Refuseless's credit API answered ${r.res.status}.`, windows: [] }
      }

      const c = r.body ?? {}
      const balance = Number.isFinite(c.balance) && c.balance >= 0 ? c.balance : 0
      const reserved = Number.isFinite(c.reserved) && c.reserved >= 0 ? c.reserved : 0
      const available =
        Number.isFinite(c.available) && c.available >= 0 ? c.available : Math.max(0, balance - reserved)

      const out = {
        plan: "Prepaid credits",
        windows: [{ name: "Credits", balance: available, unit: "USD" }],
      }
      // the wallet window is what a request can reserve; the account's total
      // is worth a second figure when a key budget or a hold makes them differ
      if (balance > available + 1e-9) out.balance = usd(balance)
      return out
    },
  },

  provider: {
    id: PROVIDER,
    async models(provider, { auth } = {}) {
      const key = apiKeyOf(auth)
      if (!key) return provider.models

      let r
      try {
        r = await getJSON(`${BASE}/models`, key)
      } catch {
        return provider.models
      }
      if (r.res.status === 401) throw expired("Refuseless rejected the API key; sign in again.")
      if (!r.res.ok) return provider.models

      const list = Array.isArray(r.body?.data) ? r.body.data : null
      if (!list) return provider.models

      const out = {}
      for (const m of list) {
        if (!m || typeof m.id !== "string" || !m.id) continue
        out[m.id] = modelOf(m.id, m, provider.models?.[m.id])
      }
      return out
    },
  },
})

export default {
  id: "refuseless",
  server: Refuseless,
}

// Functions tests can reach without being loaded as plugins.
export const _internal = { modelOf, prettyName, usd, CATALOG }
