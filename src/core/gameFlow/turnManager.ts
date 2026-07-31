import type { BoardData } from '../board/boardData'
import { Dice, type DiceLike } from '../dice'
import type { Piece } from '../pieces/piece'
import { applyMove, getValidMoves } from '../rules/parchisRules'
import type { DiceSource, MoveOption, MoveResult } from '../rules/moveOption'
import type { RuleSettings } from '../rules/ruleSettings'
import { hasWon, type PlayerState } from './playerState'

export interface DiceRoll {
  dieA: number
  dieB: number
}

type Listener<T> = (value: T) => void

class EventEmitter<T> {
  private listeners: Listener<T>[] = []
  on(listener: Listener<T>) {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }
  emit(value: T) {
    for (const listener of this.listeners) listener(value)
  }
}

// Tracks which of this roll's two dice are still unspent. A die is spent either individually (one
// piece moved by its own face value) or together as the sum (one piece moved by both at once) -
// see offerMoves, which only proposes the sum while both are still available.
interface DiceState {
  dieA: number
  dieB: number
  dieAUsed: boolean
  dieBUsed: boolean
}

// Orchestrates one local (hotseat) game: whose turn it is, rolling, offering move choices, applying
// them. Rolls two white dice per the client's rulebook (not the single-die classic variant this
// milestone started with) - a piece can move by die A's value, die B's value, or their sum, so one
// roll can move up to two different pieces (one per die) or one piece by the combined total.
export class TurnManager {
  readonly turnStarted = new EventEmitter<PlayerState>()
  readonly diceRolled = new EventEmitter<DiceRoll>()
  readonly moveChoicesReady = new EventEmitter<MoveOption[]>()
  readonly moveNotPossible = new EventEmitter<void>()
  readonly moveApplied = new EventEmitter<MoveResult>()
  readonly pieceEliminatedByDoubles = new EventEmitter<Piece>()
  readonly gameWon = new EventEmitter<PlayerState>()

  private board: BoardData
  private players: PlayerState[]
  private settings: RuleSettings
  private dice: DiceLike

  private currentPlayerIndex = 0
  private consecutiveDoubles = 0
  private lastMovedPiece: Piece | null = null
  private diceState: DiceState | null = null
  private pendingMoves: MoveOption[] | null = null

  // `dice` accepts anything roll()-shaped, not just the real Dice class - tests inject an exact
  // roll queue instead of a seed, since a seed's resulting face values aren't hand-pickable.
  constructor(board: BoardData, players: PlayerState[], settings: RuleSettings, dice: DiceLike = new Dice()) {
    this.board = board
    this.players = players
    this.settings = settings
    this.dice = dice
  }

  get currentPlayer(): PlayerState {
    return this.players[this.currentPlayerIndex]
  }

  start() {
    this.turnStarted.emit(this.currentPlayer)
  }

  requestRoll() {
    const dieA = this.dice.roll()
    const dieB = this.dice.roll()
    this.diceRolled.emit({ dieA, dieB })

    if (dieA === dieB) {
      this.consecutiveDoubles++
      if (this.settings.thirdConsecutiveDoubleEliminatesLastMoved && this.consecutiveDoubles >= 3) {
        this.consecutiveDoubles = 0
        // Home-corridor pieces are exempt - the streak just continues instead of costing a piece.
        if (this.lastMovedPiece && this.lastMovedPiece.state !== 'InHomeCorridor') {
          this.lastMovedPiece.state = 'InYard'
          this.lastMovedPiece.trackPosition = -1
          this.lastMovedPiece.corridorPosition = -1
          this.pieceEliminatedByDoubles.emit(this.lastMovedPiece)
          this.lastMovedPiece = null
          this.endTurn(false)
          return
        }
      }
    } else {
      this.consecutiveDoubles = 0
    }

    this.diceState = { dieA, dieB, dieAUsed: false, dieBUsed: false }
    this.offerMoves()
  }

  private offerMoves() {
    const state = this.diceState
    if (!state) return

    const candidates: { amount: number; source: DiceSource }[] = []
    if (!state.dieAUsed) candidates.push({ amount: state.dieA, source: 'dieA' })
    if (!state.dieBUsed) candidates.push({ amount: state.dieB, source: 'dieB' })
    if (!state.dieAUsed && !state.dieBUsed) candidates.push({ amount: state.dieA + state.dieB, source: 'sum' })

    // At most one option per piece, preferring an individual die over the sum so using the sum
    // doesn't silently swallow both dice when the player could've moved two separate pieces.
    const bestPerPiece = new Map<Piece, MoveOption>()
    for (const candidate of candidates) {
      const moves = getValidMoves(this.board, this.currentPlayer, candidate.amount, this.settings, candidate.source)
      for (const move of moves) {
        if (!bestPerPiece.has(move.piece)) bestPerPiece.set(move.piece, move)
      }
    }

    this.pendingMoves = [...bestPerPiece.values()]

    if (this.pendingMoves.length === 0) {
      this.moveNotPossible.emit()
      // Neither remaining die has a legal move - both are lost per the rulebook ("if the move is
      // impossible, the roll is lost"), not retried.
      state.dieAUsed = true
      state.dieBUsed = true
      this.finishDiceUsage()
      return
    }

    this.moveChoicesReady.emit(this.pendingMoves)
  }

  submitMove(chosenPiece: Piece) {
    const move = this.pendingMoves?.find((m) => m.piece === chosenPiece)
    if (!move || !this.diceState) return

    const result = applyMove(this.board, move, this.players, this.settings)
    this.lastMovedPiece = chosenPiece
    this.pendingMoves = null

    if (move.diceSource === 'sum') {
      this.diceState.dieAUsed = true
      this.diceState.dieBUsed = true
    } else if (move.diceSource === 'dieA') {
      this.diceState.dieAUsed = true
    } else {
      this.diceState.dieBUsed = true
    }

    this.moveApplied.emit(result)

    if (hasWon(this.currentPlayer)) {
      this.gameWon.emit(this.currentPlayer)
      return
    }

    if (!this.diceState.dieAUsed || !this.diceState.dieBUsed) {
      this.offerMoves()
      return
    }

    this.finishDiceUsage()
  }

  private finishDiceUsage() {
    this.diceState = null
    const grantExtraTurn = this.consecutiveDoubles > 0
    this.endTurn(grantExtraTurn)
  }

  private endTurn(grantExtraTurn: boolean) {
    if (!grantExtraTurn) {
      this.consecutiveDoubles = 0
      this.lastMovedPiece = null
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length
    }
    this.turnStarted.emit(this.currentPlayer)
  }
}
