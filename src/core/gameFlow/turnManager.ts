import type { BoardData } from '../board/boardData'
import { Dice } from '../dice'
import type { Piece } from '../pieces/piece'
import { applyMove, getValidMoves } from '../rules/parchisRules'
import type { MoveOption, MoveResult } from '../rules/moveOption'
import type { RuleSettings } from '../rules/ruleSettings'
import { hasWon, type PlayerState } from './playerState'

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

// Orchestrates one local (hotseat) game: whose turn it is, rolling, offering move choices, applying them.
export class TurnManager {
  readonly turnStarted = new EventEmitter<PlayerState>()
  readonly diceRolled = new EventEmitter<number>()
  readonly moveChoicesReady = new EventEmitter<MoveOption[]>()
  readonly moveNotPossible = new EventEmitter<void>()
  readonly moveApplied = new EventEmitter<MoveResult>()
  readonly gameWon = new EventEmitter<PlayerState>()

  private board: BoardData
  private players: PlayerState[]
  private settings: RuleSettings
  private dice: Dice

  private currentPlayerIndex = 0
  private consecutiveSixes = 0
  private pendingMoves: MoveOption[] | null = null

  constructor(board: BoardData, players: PlayerState[], settings: RuleSettings, diceSeed?: number) {
    this.board = board
    this.players = players
    this.settings = settings
    this.dice = new Dice(diceSeed)
  }

  get currentPlayer(): PlayerState {
    return this.players[this.currentPlayerIndex]
  }

  start() {
    this.turnStarted.emit(this.currentPlayer)
  }

  requestRoll() {
    const roll = this.dice.roll()
    this.diceRolled.emit(roll)

    if (roll === 6) {
      this.consecutiveSixes++
      // Standard Spanish parchís rule: a third six in a row burns the turn entirely, no move.
      if (this.settings.thirdConsecutiveSixForfeitsMove && this.consecutiveSixes >= 3) {
        this.consecutiveSixes = 0
        this.endTurn(false)
        return
      }
    } else {
      this.consecutiveSixes = 0
    }

    this.pendingMoves = getValidMoves(this.board, this.currentPlayer, roll, this.settings)
    if (this.pendingMoves.length === 0) {
      this.moveNotPossible.emit()
      this.endTurn(this.settings.grantExtraTurnOnSix && roll === 6)
      return
    }

    this.moveChoicesReady.emit(this.pendingMoves)
  }

  submitMove(chosenPiece: Piece) {
    const move = this.pendingMoves?.find((m) => m.piece === chosenPiece)
    if (!move) return

    const result = applyMove(this.board, move, this.players, this.settings)
    const rolledSixThisTurn = this.consecutiveSixes > 0
    this.pendingMoves = null
    this.moveApplied.emit(result)

    if (hasWon(this.currentPlayer)) {
      this.gameWon.emit(this.currentPlayer)
      return
    }

    this.endTurn(this.settings.grantExtraTurnOnSix && rolledSixThisTurn)
  }

  private endTurn(grantExtraTurn: boolean) {
    if (!grantExtraTurn) {
      this.consecutiveSixes = 0
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length
    }
    this.turnStarted.emit(this.currentPlayer)
  }
}
