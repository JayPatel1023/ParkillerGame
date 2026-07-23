export interface RuleSettings {
  entryRoll: number
  grantExtraTurnOnSix: boolean
  thirdConsecutiveSixForfeitsMove: boolean
  captureSendsToYard: boolean
}

export function defaultRuleSettings(): RuleSettings {
  return {
    entryRoll: 6,
    grantExtraTurnOnSix: true,
    thirdConsecutiveSixForfeitsMove: true,
    captureSendsToYard: true,
  }
}
