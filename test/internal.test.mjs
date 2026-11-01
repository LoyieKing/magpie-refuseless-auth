import assert from "node:assert/strict"
import test from "node:test"

import { _internal } from "../index.mjs"

const { CATALOG, creditsOf, modelOf, prettyName, usd } = _internal

test("model names for the catalog and later ids", () => {
  assert.equal(prettyName("glm-5.3-flash-abliterated"), "GLM 5.3 Flash Abliterated")
  assert.equal(prettyName("deepseek-v4.1-flash-fast"), "DeepSeek V4.1 Flash Fast")
  assert.equal(prettyName("minimax-m3.1-flash"), "MiniMax M3.1 Flash")
  assert.equal(prettyName("new-model-v2"), "New Model V2")
})

test("a live catalog entry keeps its context, efforts and prices", () => {
  const base = {
    limit: { context: 1, output: 1 },
    capabilities: { input: { text: true, image: false } },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  }
  const m = modelOf(
    "glm-5.3-flash-abliterated",
    { context_length: 1048576, reasoning_efforts: ["low", "high", "max"] },
    base,
  )
  assert.equal(m.name, "GLM 5.3 Flash Abliterated")
  assert.equal(m.limit.context, 1048576)
  assert.equal(m.limit.output, 131072)
  assert.deepEqual(Object.keys(m.variants), ["low", "high", "max"])
  assert.equal(m.capabilities.reasoning, true)
  assert.deepEqual(m.capabilities.input, { text: true, image: true })
  assert.deepEqual(m.cost, { input: 0.12, output: 0.5, cache: { read: 0.04, write: 0 } })
})

test("a model without advertised efforts has no reasoning variants", () => {
  const m = modelOf("unknown", { context_length: 32000, reasoning_efforts: [] }, undefined)
  assert.deepEqual(m.variants, {})
  assert.equal(m.capabilities.reasoning, false)
  assert.equal(m.limit.context, 32000)
})

test("usd keeps the credit endpoint's precision without trailing zeros", () => {
  assert.equal(usd(20.657952), "$20.657952")
  assert.equal(usd(0.999942), "$0.999942")
  assert.equal(usd(1), "$1.00")
  assert.equal(usd(0), "$0.00")
  assert.equal(usd(Number.NaN), "")
})

test("the fallback catalog covers the five live models", () => {
  assert.deepEqual(Object.keys(CATALOG).sort(), [
    "deepseek-v4.1-flash-abliterated",
    "deepseek-v4.1-flash-fast",
    "glm-5.3-abliterated",
    "glm-5.3-flash-abliterated",
    "minimax-m3.1-flash",
  ])
})

test("a key without a budget shows the account balance", () => {
  assert.deepEqual(creditsOf({ balance: 20.657952, reserved: 0, available: 20.657952, key_limit: null }), {
    plan: "Prepaid credits",
    balance: "$20.657952",
    windows: [],
  })
})

test("a key with a budget shows what it can still spend", () => {
  assert.deepEqual(creditsOf({ balance: 20.65, reserved: 0.01, available: 0.999942, key_limit: 0.999942 }), {
    plan: "Prepaid credits",
    windows: [{ name: "Credits", balance: 0.999942, unit: "USD" }],
  })
})

test("an exhausted key budget is still a window, not a zero balance", () => {
  assert.deepEqual(creditsOf({ balance: 20, reserved: 0, available: 0, key_limit: 0 }), {
    plan: "Prepaid credits",
    windows: [{ name: "Credits", balance: 0, unit: "USD" }],
  })
})
