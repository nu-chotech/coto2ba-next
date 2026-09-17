// DESIGN.md の候補選択を、模擬語彙だけで体験する独立した画面。
// 本番では候補生成・確定・状態更新をサーバーが担当する。
const vectors = {
  りんご: [0.95, 0.05, 0.02], 果実: [0.9, 0.12, 0.04], 森: [0.7, 0.1, 0.3],
  金: [0.1, 0.9, 0.06], 宝石: [0.18, 0.83, 0.13], 市場: [0.22, 0.76, 0.18],
  ロケット: [0.08, 0.1, 0.94], 星: [0.1, 0.08, 0.92], 銀河: [0.03, 0.05, 0.99],
  宇宙: [0, 0, 1], 夢: [0.38, 0.22, 0.76], 発明: [0.32, 0.45, 0.68],
}
const goal = '宇宙'
const words = Object.keys(vectors)
const byId = (id) => document.getElementById(id)
const normalize = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n) }
const cosine = (a, b) => normalize(a).reduce((sum, x, i) => sum + x * normalize(b)[i], 0)
const targetSimilarity = (word) => cosine(vectors[word], vectors[goal])
let state
let pending = null

function reset() {
  state = { current: 'りんご', history: ['りんご'], turn: 0, combo: 0, previous: null }
  pending = null
  byId('material-a').value = state.current
  byId('material-b').value = '金'
  byId('candidates').textContent = '素材を選んで候補を表示してください。'
  renderState()
}

function renderState() {
  byId('current').textContent = state.current
  byId('turn').textContent = state.turn
  byId('combo').textContent = state.combo
  byId('history').replaceChildren(...state.history.map((word) => {
    const li = document.createElement('li')
    li.textContent = word
    return li
  }))
}

function candidates(a, b, alpha, combo) {
  const normalizedA = normalize(vectors[a])
  const normalizedB = normalize(vectors[b])
  const query = normalize(normalizedA.map((value, i) => alpha * value + (1 - alpha) * normalizedB[i]))
  const beta = Math.min(0.22, 0.03 + combo * 0.025)
  const pool = words.filter((word) => word !== a && word !== b)
    .map((word) => ({ word, blend: cosine(vectors[word], query) }))
    .sort((left, right) => right.blend - left.blend || left.word.localeCompare(right.word))
    .slice(0, 24)
  return pool.map(({ word, blend }) => ({ word, score: (1 - beta) * blend + beta * targetSimilarity(word) }))
    .sort((left, right) => right.score - left.score || left.word.localeCompare(right.word))
    .slice(0, 3)
}

function generate() {
  if (state.current === goal) return
  const a = byId('material-a').value
  const b = byId('material-b').value
  const alpha = Number(byId('alpha').value) / 100
  pending = { id: crypto.randomUUID(), options: candidates(a, b, alpha, state.combo) }
  const cards = pending.options.map(({ word, score }) => {
    const card = document.createElement('div')
    card.className = 'candidate'
    const label = document.createElement('span')
    label.textContent = `${word} · 合成スコア ${score.toFixed(3)}`
    const button = document.createElement('button')
    button.textContent = 'この語を確定'
    button.addEventListener('click', () => confirm(pending.id, word))
    card.append(label, button)
    return card
  })
  byId('candidates').replaceChildren(...cards)
}

function confirm(setId, word) {
  if (pending?.id !== setId || !pending.options.some((option) => option.word === word)) return
  const similarity = targetSimilarity(word)
  state.combo = state.previous !== null && similarity > state.previous ? state.combo + 1 : 0
  state.previous = similarity
  state.current = word
  state.history.push(word)
  state.turn += 1
  pending = null
  byId('material-a').value = word
  byId('candidates').textContent = word === goal ? '目標語に到達しました。' : '確定しました。次の候補を作れます。'
  renderState()
}

for (const id of ['material-a', 'material-b']) {
  for (const word of words) byId(id).add(new Option(word, word))
}
byId('alpha').addEventListener('input', (event) => { byId('alpha-value').textContent = `${event.target.value}%` })
byId('generate').addEventListener('click', generate)
byId('reset').addEventListener('click', reset)
reset()
