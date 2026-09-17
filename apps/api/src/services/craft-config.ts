/** alchemy-python の仮パラメータ。実語彙の測定後に調整する。 */
export const CRAFT_CONFIG = {
  poolSize: 24,
  candidateCount: 3,
  betaNormal: 0.03,
  betaEasy: 0.12,
  comboBonus: 0.025,
  betaMax: 0.22,
} as const

export function craftBeta(
  difficulty: 'easy' | 'normal' | 'hard', combo: number,
  comboEnabled: boolean, goalBiasEnabled: boolean,
): number {
  if (!goalBiasEnabled) return 0
  const base = difficulty === 'easy' ? CRAFT_CONFIG.betaEasy : CRAFT_CONFIG.betaNormal
  return Math.min(CRAFT_CONFIG.betaMax, base + (comboEnabled ? combo * CRAFT_CONFIG.comboBonus : 0))
}
