// Matches the client's official rulebook (2 white dice), not the classic single-die variant this
// milestone started with - see TurnManager for how the two dice get offered as three usable
// amounts (die A, die B, their sum) per roll.
export interface RuleSettings {
  exitRoll: number
  thirdConsecutiveDoubleEliminatesLastMoved: boolean
  captureSendsToYard: boolean
}

export function defaultRuleSettings(): RuleSettings {
  return {
    exitRoll: 5,
    thirdConsecutiveDoubleEliminatesLastMoved: true,
    captureSendsToYard: true,
  }
}
