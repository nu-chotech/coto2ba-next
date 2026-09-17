const vectors = {
  りんご: [0.95, 0.05, 0.02],
  果実: [0.9, 0.12, 0.04],
  森: [0.7, 0.1, 0.3],
  金: [0.1, 0.9, 0.06],
  宝石: [0.18, 0.83, 0.13],
  市場: [0.22, 0.76, 0.18],
  ロケット: [0.08, 0.1, 0.94],
  星: [0.1, 0.08, 0.92],
  銀河: [0.03, 0.05, 0.99],
  宇宙: [0, 0, 1],
  夢: [0.38, 0.22, 0.76],
  発明: [0.32, 0.45, 0.68],
}
const labels = {
  mix: '混合',
  slerp: '球面補間',
  subtract: '差し引き',
  repel: '反発',
  purify: '直交成分を加える',
}
const notes = {
  mix: '2語の中間へ進む',
  slerp: '方向を球面上でなめらかに補間',
  subtract: '入力語らしさを引く',
  repel: '目標へ寄せつつ入力語から離す',
  purify: '現在語と重ならない意味だけ足す',
}
const current = 'りんご'
const goal = '宇宙'
const byId = (id) => document.getElementById(id)
const normalize = (v) => {
  const n = Math.hypot(...v)
  return v.map((x) => x / n)
}
const cosine = (a, b) => normalize(a).reduce((sum, value, i) => sum + value * normalize(b)[i], 0)

function operate(operation, word, ratio) {
  const a = normalize(vectors[current])
  const b = normalize(vectors[word])
  const g = normalize(vectors[goal])
  const dot = cosine(a, b)
  if (operation === 'slerp') {
    const omega = Math.acos(Math.max(-1, Math.min(1, dot)))
    if (Math.abs(Math.sin(omega)) > 1e-6) {
      return normalize(
        a.map(
          (value, i) =>
            (Math.sin((1 - ratio) * omega) / Math.sin(omega)) * value +
            (Math.sin(ratio * omega) / Math.sin(omega)) * b[i],
        ),
      )
    }
  }
  return normalize(
    a.map((value, i) => {
      if (operation === 'subtract') return value - ratio * b[i]
      if (operation === 'repel') return value + ratio * g[i] - ratio * 0.78 * b[i]
      if (operation === 'purify') return value + ratio * (b[i] - dot * value)
      return (1 - ratio) * value + ratio * b[i]
    }),
  )
}

function compare() {
  const ingredient = byId('ingredient').value
  const ratio = Number(byId('ratio').value) / 100
  const cards = Object.keys(labels).map((operation) => {
    const vector = operate(operation, ingredient, ratio)
    const candidates = Object.keys(vectors).filter(
      (word) => word !== current && word !== ingredient,
    )
    const result = candidates.sort(
      (a, b) => cosine(vectors[b], vector) - cosine(vectors[a], vector),
    )[0]
    const card = document.createElement('div')
    card.className = 'result'
    const title = document.createElement('strong')
    title.textContent = labels[operation]
    const word = document.createElement('strong')
    word.textContent = result
    const detail = document.createElement('p')
    detail.textContent = `${notes[operation]} · 目標との近さ ${cosine(vectors[result], vectors[goal]).toFixed(3)}`
    card.append(title, word, detail)
    return card
  })
  byId('results').replaceChildren(...cards)
}

for (const word of Object.keys(vectors).filter((word) => word !== current && word !== goal)) {
  byId('ingredient').add(new Option(word, word))
}
byId('ingredient').value = '金'
byId('ratio').addEventListener('input', (event) => {
  byId('ratio-value').textContent = `${event.target.value}%`
})
byId('compare').addEventListener('click', compare)
compare()
