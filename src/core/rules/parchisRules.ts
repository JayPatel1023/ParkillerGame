import type { BoardData } from '../board/boardData'
import type { PlayerState } from '../gameFlow/playerState'
import type { PieceColor } from '../pieceColor'
import type { Parkiller } from '../pieces/parkiller'
import type { Piece } from '../pieces/piece'
import type { DiceSource, MoveOption, MoveResult } from './moveOption'
import type { RuleSettings } from './ruleSettings'

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

// A Parkiller still crossing its own lane's home corridor (see Parkiller.corridorPosition's own
// doc comment) has a trackPosition that's stale/meaningless - it's still sitting at
// homeEntranceTrackIndex, unmoved, until corridorPosition actually reaches corridorLength. Every
// track-position collision check (capturing it, being captured by it, being endangered by it) needs
// to gate on this first, or a pawn landing on that lane's own entrance square would falsely "catch"
// a Parkiller that's still visually back in the corridor, nowhere near the shared track at all.
export function isParkillerOnTrack(parkiller: Parkiller): boolean {
  return parkiller.state === 'InPlay' && parkiller.corridorPosition >= parkiller.corridorLength
}

// PC2 ("There can never be more than two pawns per square") / PC2.4 (barriers): verified directly
// against the client's own reference implementation - a track square with 2 pieces already on it
// (regardless of color) blocks every other piece from landing there OR passing through it as an
// intermediate step of a longer move. The Parkiller is exempt from this *as a mover* (PK4: "the
// Parkiller can jump over barriers") - it never goes through getValidMoves, it's resolved
// separately in TurnManager. It is NOT exempt as an occupant other pieces' moves need to see -
// this function only counts pawns, so use occupantsOnTrackSquare (below) wherever a move's
// legality depends on a square's true total occupancy, not this alone.
function piecesOnTrackSquare(allPlayers: readonly PlayerState[], trackPosition: number): number {
  let count = 0
  for (const player of allPlayers) {
    for (const piece of player.pieces) {
      if (piece.state === 'OnTrack' && piece.trackPosition === trackPosition) count++
    }
  }
  return count
}

function parkillersOnTrackSquare(allPlayers: readonly PlayerState[], trackPosition: number): number {
  let count = 0
  for (const player of allPlayers) {
    if (isParkillerOnTrack(player.parkiller) && player.parkiller.trackPosition === trackPosition) count++
  }
  return count
}

// Reported directly, with a screenshot: an opposing Parkiller and a Red pawn were already
// coexisting on Red's own entry square (correct - PK4, a protected square) when a second Red pawn
// exited onto that same square with nothing blocking or resolving it, leaving three pieces stacked
// on one square. Root cause: every occupancy check in this file (piecesOnTrackSquare included) only
// ever counted pawns - a Parkiller lives in PlayerState.parkiller, not the pieces array, so it was
// structurally invisible to every "is this square already full" question. Verified directly
// against the reference implementation (Parkiller_GameMaker-main): a square's own occupancy list
// (fichasActualmente) holds Parkillers too, filtered out only where that code specifically means
// pawns-only. Use this, not piecesOnTrackSquare alone, wherever a move's legality actually depends
// on the square's true total occupancy.
function occupantsOnTrackSquare(allPlayers: readonly PlayerState[], trackPosition: number): number {
  return piecesOnTrackSquare(allPlayers, trackPosition) + parkillersOnTrackSquare(allPlayers, trackPosition)
}

// Home-corridor squares are private to one color (no opponent piece can ever enter another
// color's corridor), so occupancy here is just "how many of my own pieces already sit here".
// Verified directly against the reference implementation's own puedeApilarEnFinales() - every
// corridor square but the true final one caps at 2 of the player's own pieces, exactly like PC2's
// general "never more than two pawns per square" rule (a corridor barrier is a real, legal thing,
// not a track-only concept - PC2.4's own rulebook text explicitly calls out doubles forcing a
// barrier open "including those in the finish zone"); the final square alone allows all 4 to stack
// freely once finished. An earlier version of this comment claimed the cap was 1, not 2 - that was
// wrong, traced to having read the general per-square cap check without finding
// puedeApilarEnFinales's own more permissive rule for corridor squares specifically.
function ownPiecesInCorridor(allPlayers: readonly PlayerState[], color: PieceColor, corridorPosition: number): number {
  let count = 0
  for (const player of allPlayers) {
    if (player.color !== color) continue
    for (const piece of player.pieces) {
      if (piece.state === 'InHomeCorridor' && piece.corridorPosition === corridorPosition) count++
    }
  }
  return count
}

function piecesOfColorOnTrackSquare(allPlayers: readonly PlayerState[], color: PieceColor, trackPosition: number): number {
  let count = 0
  for (const player of allPlayers) {
    if (player.color !== color) continue
    for (const piece of player.pieces) {
      if (piece.state === 'OnTrack' && piece.trackPosition === trackPosition) count++
    }
  }
  return count
}

// Same query as piecesOnTrackSquare, but returns the actual pieces - needed wherever *which*
// piece(s) occupy a square matters (color composition, arrival order), not just the count.
function piecesAtTrackSquare(allPlayers: readonly PlayerState[], trackPosition: number): Piece[] {
  const result: Piece[] = []
  for (const player of allPlayers) {
    for (const piece of player.pieces) {
      if (piece.state === 'OnTrack' && piece.trackPosition === trackPosition) result.push(piece)
    }
  }
  return result
}

// `amount` is a single usable step count - the caller (TurnManager) decides whether that's one
// die's face value or the sum of both, and passes `diceSource` along purely so the resulting
// MoveOption records which of this roll's dice it would spend. This function itself has no
// concept of "two dice" - it just answers "what can move by this many steps", the same question
// regardless of where the number came from.
export function getValidMoves(
  board: BoardData,
  player: PlayerState,
  allPlayers: readonly PlayerState[],
  amount: number,
  settings: RuleSettings,
  diceSource: DiceSource = 'sum',
): MoveOption[] {
  const lane = board.lanes[player.color]
  if (!lane) return []

  const moves: MoveOption[] = []

  for (const piece of player.pieces) {
    if (piece.state === 'Finished') continue

    if (piece.state === 'InYard') {
      if (amount === settings.exitRoll) {
        // PC2.1: blocked by 2 of the player's own pawns already there (an already-formed own
        // barrier), or by 2 *same-color* opposing pawns (a real foreign barrier - PC2.4 says
        // nothing, not even a piece of that same color, can pass over a barrier, and this exit
        // isn't the shelter owner's own piece for that square). A single opposing pawn already
        // there is NOT blocked - the exiting pawn simply joins it (2 total) with no capture yet;
        // only a further, 3rd own pawn joining that same mixed square captures the opponent (see
        // applyMove) - verified directly against the reference implementation, which does not
        // capture a lone opponent on a plain single exit, only once a 2nd own pawn joins it.
        // Two *different-colored* opposing pawns are a distinct case the rulebook calls out by
        // name (PC2.1): not a formed barrier at all (PC2.4 barriers are same-color, or different
        // colors specifically on a protected square - this is neither), so the exit still isn't
        // blocked - it lands and eliminates whichever of the two arrived later (see applyMove's
        // captureAt, which already handles the "2 opposing pieces" case via
        // resolveBarrierElimination).
        // Own barrier and foreign-barrier detection both need to count a Parkiller sitting on this
        // square exactly like a pawn (see occupantsOnTrackSquare's own comment - a screenshotted
        // 3-piece stack traced back to every check here only ever seeing pawns): the player's own
        // pawn + their own Parkiller already occupying the entry square is just as real an "own
        // barrier" as two own pawns, and one opposing pawn + that exact opponent's own Parkiller is
        // just as real a foreign barrier as two opposing pawns of that color.
        const ownParkillerOnEntry = isParkillerOnTrack(player.parkiller) && player.parkiller.trackPosition === lane.entryTrackIndex
        const ownOnEntry = piecesOfColorOnTrackSquare(allPlayers, player.color, lane.entryTrackIndex) + (ownParkillerOnEntry ? 1 : 0)
        const opposingAtEntry = piecesAtTrackSquare(allPlayers, lane.entryTrackIndex).filter((p) => p.color !== player.color)
        const opposingParkillerColorsAtEntry = allPlayers
          .filter((p) => p.color !== player.color && isParkillerOnTrack(p.parkiller) && p.parkiller.trackPosition === lane.entryTrackIndex)
          .map((p) => p.color)
        const opposingColorsAtEntry = [...opposingAtEntry.map((p) => p.color), ...opposingParkillerColorsAtEntry]
        const foreignBarrier = opposingColorsAtEntry.length >= 2 && opposingColorsAtEntry.every((c) => c === opposingColorsAtEntry[0])
        const blockedByOccupancy = ownOnEntry >= 2 || foreignBarrier
        if (!blockedByOccupancy) {
          moves.push({
            piece,
            kind: 'ExitYard',
            resultingTrackPosition: lane.entryTrackIndex,
            resultingCorridorPosition: -1,
            amount,
            diceSource,
          })
        }
      }
      continue
    }

    if (piece.state === 'OnTrack') {
      const distanceToHomeEntrance = mod(lane.homeEntranceTrackIndex - piece.trackPosition, board.trackLength)
      const totalStepsToFinish = distanceToHomeEntrance + lane.corridorLength

      if (amount > totalStepsToFinish) continue // overshoot past home - exact count required

      // PC2.4: a barrier blocks passage, not just landing - walk every square this move crosses
      // (not the final one, checked separately below with its own landing rules).
      //
      // Reported directly, via a systematic rules audit Carlos himself requested: this loop used
      // to always treat every intermediate step as a *shared-track* square
      // ((piece.trackPosition + step) % board.trackLength), even once step had actually carried the
      // piece past the home entrance into its own private home-corridor coordinate space - a
      // completely separate index range, not a continuation of the track loop. Two confirmed bugs
      // from that one mistake: (1) a real barrier sitting inside the corridor could be silently
      // walked straight through, since ownPiecesInCorridor (the function that actually checks a
      // corridor square) was never consulted for any square except the final landing one; (2) the
      // wrapped-around track index a corridor-crossing step computed could accidentally *alias* a
      // real but entirely unrelated barrier elsewhere on the shared track (a different player's
      // own barrier, nowhere near this piece's real path), falsely blocking an otherwise-legal move
      // that never actually touches that square. Splitting the check by whether a given step is
      // still on the shared track (<=distanceToHomeEntrance) or has already crossed into the
      // corridor (the same split the landing-square logic just below already makes) fixes both.
      let blockedInTransit = false
      for (let step = 1; step < amount; step++) {
        if (step <= distanceToHomeEntrance) {
          const intermediatePos = (piece.trackPosition + step) % board.trackLength
          // occupantsOnTrackSquare, not piecesOnTrackSquare alone - a barrier a pawn and an
          // opposing Parkiller form together (PK4) blocks transit exactly like a 2-pawn one does.
          if (occupantsOnTrackSquare(allPlayers, intermediatePos) >= 2) {
            blockedInTransit = true
            break
          }
        } else {
          const intermediateCorridorIndex = step - distanceToHomeEntrance - 1
          if (ownPiecesInCorridor(allPlayers, player.color, intermediateCorridorIndex) >= 2) {
            blockedInTransit = true
            break
          }
        }
      }
      if (blockedInTransit) continue

      if (amount <= distanceToHomeEntrance) {
        const newTrackPos = (piece.trackPosition + amount) % board.trackLength
        // Landing (unlike ExitYard, see that branch's own comment) is blocked outright when the
        // destination is already full, Parkiller included - verified directly against the
        // reference implementation's own puedeAvanzarDesde(), which rejects a normal move's
        // destination the same unconditional way. Exiting the yard is the one deliberate exception
        // (PC2.1's own exit obligation always at least attempts to land, then lets PK5 resolve an
        // already-full protected square by sending the exiting pawn straight back - see applyMove).
        if (occupantsOnTrackSquare(allPlayers, newTrackPos) >= 2) continue
        moves.push({
          piece,
          kind: 'TrackMove',
          resultingTrackPosition: newTrackPos,
          resultingCorridorPosition: -1,
          amount,
          diceSource,
        })
      } else {
        const corridorIndex = amount - distanceToHomeEntrance - 1
        const isFinal = corridorIndex === lane.corridorLength - 1
        if (!isFinal && ownPiecesInCorridor(allPlayers, player.color, corridorIndex) >= 2) continue
        const kind = isFinal ? 'FinishMove' : 'CorridorMove'
        moves.push({ piece, kind, resultingTrackPosition: -1, resultingCorridorPosition: corridorIndex, amount, diceSource })
      }
      continue
    }

    if (piece.state === 'InHomeCorridor') {
      const newCorridorPos = piece.corridorPosition + amount
      if (newCorridorPos > lane.corridorLength - 1) continue // overshoot - exact count required

      // Same transit gap as the OnTrack case above, purely within the corridor this time - a move
      // that starts already inside the corridor had no transit check at all before, only ever
      // checking the final landing square below.
      let blockedInCorridorTransit = false
      for (let step = piece.corridorPosition + 1; step < newCorridorPos; step++) {
        if (ownPiecesInCorridor(allPlayers, player.color, step) >= 2) {
          blockedInCorridorTransit = true
          break
        }
      }
      if (blockedInCorridorTransit) continue

      const isFinal = newCorridorPos === lane.corridorLength - 1
      if (!isFinal && ownPiecesInCorridor(allPlayers, player.color, newCorridorPos) >= 2) continue
      const kind = isFinal ? 'FinishMove' : 'CorridorMove'
      moves.push({ piece, kind, resultingTrackPosition: -1, resultingCorridorPosition: newCorridorPos, amount, diceSource })
    }
  }

  return moves
}

// PC3/PK8: capturing is mandatory whenever available, not just one option among others - a player
// can't dodge an available capture by choosing to move a different piece instead. TurnManager uses
// this to filter its offered moves down to only the capturing ones whenever any exist. Pure/
// read-only (no mutation), so it can be checked before a move is actually applied.
export function wouldCapture(
  board: BoardData,
  move: MoveOption,
  allPlayers: readonly PlayerState[],
  allowParkillerCapture: boolean,
): boolean {
  if (move.kind !== 'ExitYard' && move.kind !== 'TrackMove') return false
  const pos = move.resultingTrackPosition

  // PK6: "Se mueve con la cifra de un dado el peón que elimina al Parkiller" - the capturing move
  // must spend a single die's own face value, not the sum of both. A double's sum landing on the
  // Parkiller's square doesn't count, even though the same double's individual die value might.
  const usesSingleDie = move.diceSource === 'dieA' || move.diceSource === 'dieB'
  for (const opponent of allPlayers) {
    if (opponent.color === move.piece.color) continue
    if (allowParkillerCapture && usesSingleDie && isParkillerOnTrack(opponent.parkiller) && opponent.parkiller.trackPosition === pos)
      return true
  }

  // PC2.2: safe zones protect pawns from capture *except* on a player's own starting square, the
  // instant that player exits a pawn onto it - an ExitYard landing always targets the mover's own
  // lane's entry square, so this exception never needs a color check of its own.
  if (move.kind !== 'ExitYard' && board.safeTrackIndices.has(pos)) return false
  for (const opponent of allPlayers) {
    if (opponent.color === move.piece.color) continue
    for (const opponentPiece of opponent.pieces) {
      if (opponentPiece.state === 'OnTrack' && opponentPiece.trackPosition === pos) return true
    }
  }
  return false
}

export function applyMove(
  board: BoardData,
  move: MoveOption,
  allPlayers: readonly PlayerState[],
  settings: RuleSettings,
  allowParkillerCapture: boolean,
  // TurnManager's own monotonic counter (not a wall-clock timestamp) - see Piece.arrivedAt's own
  // comment. Optional/defaulted so every existing caller (tests included) that doesn't care about
  // arrival order keeps working unchanged.
  arrivalSequence = 0,
): MoveResult {
  const piece = move.piece
  const result: MoveResult = { movedPiece: piece, amount: move.amount, capturedPiece: null, capturedParkillerColor: null, pieceFinished: false }

  switch (move.kind) {
    case 'ExitYard':
    case 'TrackMove': {
      piece.state = 'OnTrack'
      piece.trackPosition = move.resultingTrackPosition
      piece.corridorPosition = -1
      piece.arrivedAt = arrivalSequence
      // PC2.1 names two exceptions to the entry square's usual safe-zone protection (PC2.2), both
      // only for an ExitYard landing (never a plain TrackMove) - piece.trackPosition is already
      // set above, so `occupantsAtDestination` below includes the mover itself.
      const occupantsAtDestination = move.kind === 'ExitYard' ? piecesAtTrackSquare(allPlayers, move.resultingTrackPosition) : []
      // Reported directly, via a stress test simulating full games: a Gold pawn exited onto its own
      // entry square where Gold's *own* Parkiller (landed there via that same roll's own black die)
      // and a lone opposing (Purple) pawn already sat together - a real, full "Parki + different-
      // color pawn" barrier (client's own BARRIERS rules page, case 5). ownAtDestination below used
      // to only ever count *pawns*, so it saw just the one arriving Gold pawn (=1, not >1) and never
      // recognized this as "an own piece joining an own piece already here" the way it already does
      // for two own *pawns* - Purple's pawn was never captured, leaving 3 pieces stacked on one
      // square instead of correctly resolving back down to 2 (Gold's new pawn + its own Parkiller,
      // with Purple's pawn bumped the same way a second own pawn joining already bumps a lone
      // opponent). Same domain-model equivalence getValidMoves' own ExitYard blocking check already
      // uses elsewhere in this file ("the player's own pawn + their own Parkiller... is just as real
      // an own barrier as two own pawns").
      const owner = allPlayers.find((p) => p.color === piece.color)
      const ownParkillerAtDestination =
        move.kind === 'ExitYard' && !!owner && isParkillerOnTrack(owner.parkiller) && owner.parkiller.trackPosition === move.resultingTrackPosition
      const ownAtDestination = occupantsAtDestination.filter((p) => p.color === piece.color).length + (ownParkillerAtDestination ? 1 : 0)
      const opposingAtDestination = occupantsAtDestination.filter((p) => p !== piece && p.color !== piece.color)
      // 1) joining an own pawn (or own Parkiller) already there (>1 own, counting the mover) - a
      //    lone opponent already on the square doesn't get captured by a first exit, only once a
      //    further own piece joins that same mixed square.
      const joiningOwnPawn = ownAtDestination > 1
      // 2) two *different-colored* opposing pawns already sharing the square (not a real barrier
      //    - see getValidMoves' own comment on foreignBarrier) - PC2.1 names this outright:
      //    "the last one to arrive is eliminated".
      const exposedForeignPair = ownAtDestination === 1 && opposingAtDestination.length === 2 && opposingAtDestination[0].color !== opposingAtDestination[1].color
      result.capturedPiece = settings.captureSendsToYard
        ? captureAt(board, piece, move.resultingTrackPosition, allPlayers, joiningOwnPawn || exposedForeignPair)
        : null
      // PK6/PK8: a common piece only eliminates the Parkiller during the roll that just produced
      // doubles (the reference implementation's own doblete_mata_parkiller flag) - landing on it
      // any other time does nothing at all, verified directly against that source. And even on a
      // double, only a single die's own value counts, not their sum (see wouldCapture).
      const usesSingleDie = move.diceSource === 'dieA' || move.diceSource === 'dieB'
      result.capturedParkillerColor = allowParkillerCapture && usesSingleDie
        ? captureParkillerAt(piece, move.resultingTrackPosition, allPlayers)
        : null
      // PK5: landing on an unprotected opposing Parkiller without eliminating it (PK6, just
      // above) turns the tables instead - the arriving pawn is sent straight back to its own
      // yard, with no reward. Verified directly against the reference implementation's
      // ingresaFicha(): the move is never blocked outright, it always completes first and only
      // then bounces the arriving pawn home.
      if (!result.capturedParkillerColor) {
        const dangerColor = unprotectedOpposingParkillerColorAt(board, piece.color, move.resultingTrackPosition, allPlayers)
        if (dangerColor) {
          result.eliminatedByParkiller = true
          result.eliminatedByParkillerAt = move.resultingTrackPosition
          result.eliminatedByParkillerColor = dangerColor
          piece.state = 'InYard'
          piece.trackPosition = -1
        }
      }
      break
    }

    case 'CorridorMove':
      piece.state = 'InHomeCorridor'
      piece.trackPosition = -1
      piece.corridorPosition = move.resultingCorridorPosition
      break

    case 'FinishMove':
      piece.state = 'Finished'
      piece.trackPosition = -1
      piece.corridorPosition = move.resultingCorridorPosition
      result.pieceFinished = true
      break
  }

  return result
}

function captureAt(
  board: BoardData,
  mover: Piece,
  trackPosition: number,
  allPlayers: readonly PlayerState[],
  bypassSafeZone: boolean,
): Piece | null {
  // PC2.2: a shelter owner's own exit breaks that square's usual protection, but only in the two
  // cases applyMove's own callers name explicitly (joiningOwnPawn / exposedForeignPair) - every
  // other landing, including a first lone exit onto a single opponent, still respects it.
  if (!bypassSafeZone && board.safeTrackIndices.has(trackPosition)) return null

  const opposingPieces: Piece[] = []
  for (const opponent of allPlayers) {
    if (opponent.color === mover.color) continue
    for (const opponentPiece of opponent.pieces) {
      if (opponentPiece.state === 'OnTrack' && opponentPiece.trackPosition === trackPosition) opposingPieces.push(opponentPiece)
    }
  }
  // PC2.1: when two different-colored opponents already share the destination (exposedForeignPair
  // above), which one goes isn't "whichever this loop finds first" - it's whichever arrived later
  // (same resolveBarrierElimination the Parkiller's own barrier landings use - see its own
  // comment). A single opponent just uses it directly.
  const target = opposingPieces.length >= 2 ? resolveBarrierElimination(mover.color, opposingPieces) : (opposingPieces[0] ?? null)
  if (target) {
    target.state = 'InYard'
    target.trackPosition = -1
  }
  return target
}

// PK6: landing exactly on an opposing color's Parkiller eliminates it permanently (unlike a
// regular pawn, it doesn't go back to a yard - it's simply out for the rest of the game). Not
// restricted by safeTrackIndices - the rulebook only protects a Parkiller's *target* pawn from
// the Parkiller itself (PK5), not the Parkiller from being caught by a pawn. Callers already gate
// this on allowParkillerCapture (PK6/PK8) before calling it.
function captureParkillerAt(mover: Piece, trackPosition: number, allPlayers: readonly PlayerState[]): PieceColor | null {
  for (const opponent of allPlayers) {
    if (opponent.color === mover.color) continue
    if (isParkillerOnTrack(opponent.parkiller) && opponent.parkiller.trackPosition === trackPosition) {
      opponent.parkiller.state = 'Eliminated'
      return opponent.color
    }
  }
  return null
}

// PK5: read-only check for whether landing here puts the mover in danger - an opposing Parkiller,
// still in play, on an unprotected square. Safe/protected squares are exempt (PK4: the two simply
// form a barrier instead), and this only ever matters for the destination square itself, not any
// square passed through along the way.
//
// Reported directly, with a screenshot: an opposing Parkiller and a Red pawn were already
// coexisting on Red's own (protected) entry square when a second Red pawn exited there too,
// leaving three pieces stacked on one square. Root cause here specifically: the safe-square
// exemption below used to be unconditional - it shielded the *arriving* pawn even when the square
// already held a full 2-occupant barrier (that pawn + the opposing Parkiller) before this piece
// even arrived, joining as an illegal 3rd. This is the exact mirror of a bug already fixed the
// other direction in TurnManager.resolveParkillerCollisions (see that function's own comment for
// the full reasoning) - a protected square's shield only ever covers a landing that still has
// room, not one that's already full. Called from applyMove after piece.trackPosition has already
// been set to this same trackPosition (see that function's own comment on occupantsAtDestination),
// so occupantsOnTrackSquare's own count here includes the mover - subtracted back out below to get
// what was actually there *before* this arrival, matching the reference implementation's own
// pre-arrival ds_list_size check.
function unprotectedOpposingParkillerColorAt(
  board: BoardData,
  color: PieceColor,
  trackPosition: number,
  allPlayers: readonly PlayerState[],
): PieceColor | null {
  let dangerColor: PieceColor | null = null
  for (const opponent of allPlayers) {
    if (opponent.color === color) continue
    if (isParkillerOnTrack(opponent.parkiller) && opponent.parkiller.trackPosition === trackPosition) {
      dangerColor = opponent.color
      break
    }
  }
  if (!dangerColor) return null
  if (!board.safeTrackIndices.has(trackPosition)) return dangerColor
  const occupantsBeforeThisArrival = occupantsOnTrackSquare(allPlayers, trackPosition) - 1
  return occupantsBeforeThisArrival < 2 ? null : dangerColor
}

// PK5/PK10: a Parkiller landing on a square already held by a barrier (2 pawns, own or mixed)
// never just coexists with both, and never gets blocked either - it always eliminates exactly
// one of the two. Which one follows the rulebook's own PK10 worked examples: a pawn that shares
// the Parkiller's own color is protected ahead of one that doesn't ("a pawn protects its
// Parkiller"/"if one of the pawns is the same color, the other player's pawn is eliminated") -
// only once color alone doesn't decide it (both pawns share a color, whether that's the
// Parkiller's own or a third one) does arrival order break the tie ("eliminates the last one to
// arrive"), using Piece.arrivedAt (a turn-sequence counter, not a timestamp - see its own
// comment). Pure/read-only - callers apply the actual elimination themselves.
export function resolveBarrierElimination(moverColor: PieceColor, piecesAtSquare: readonly Piece[]): Piece | null {
  const [a, b] = piecesAtSquare
  if (!a || !b) return null
  const aMatches = a.color === moverColor
  const bMatches = b.color === moverColor
  if (aMatches !== bMatches) return aMatches ? b : a // exactly one shares the mover's color - the other one goes
  return a.arrivedAt >= b.arrivedAt ? a : b // both (mis)match the same way - later arrival goes
}

// PK9.1: "the same number on both dice (double)" obligates removing an existing barrier of the
// player's *own* pawns before anything else that roll (PK9's own priority order puts this ahead of
// PK9.2's rewards and PK9.3's shelter removal) - a barrier merely shared with an opponent (one own
// pawn, one foreign) isn't "the player's own" to have to open, so only a same-color pair counts.
// Only the player's own 4 pieces need checking, not the whole track. Returns the first one found if
// somehow more than one exists (a rare-enough double edge case not worth its own tie-break rule).
// A pawn sharing a square with the player's *own* Parkiller counts as this same "own barrier" too -
// occupantsOnTrackSquare (above) already treats that pairing as a real 2-occupant barrier for
// blocking everyone else's passage, so treating it as anything less than a real barrier here (the
// one place that still only scanned player.pieces) left it structurally invisible to both PK9.1's
// double-break priority and pieceIsInOwnBarrier's own non-double lockout - reported directly
// ("no hay opción para que avance la que forma barrera con el Parki"): a double that also happened
// to be the exit roll forced every yard pawn out instead, and the exit could land the exiting pawn
// straight into an elimination the player had no way to avoid, since the actually-correct move (the
// pawn breaking its barrier with the Parkiller) was never offered at all. Only the pawn half of the
// pairing can ever appear as a candidate move here - the Parkiller itself never moves via these two
// white dice, only its own black die - so nothing further is needed to keep this scoped correctly.
export function ownBarrierTrackPosition(player: PlayerState): number | null {
  const counts = new Map<number, number>()
  for (const piece of player.pieces) {
    if (piece.state !== 'OnTrack') continue
    counts.set(piece.trackPosition, (counts.get(piece.trackPosition) ?? 0) + 1)
  }
  if (isParkillerOnTrack(player.parkiller)) {
    const pos = player.parkiller.trackPosition
    counts.set(pos, (counts.get(pos) ?? 0) + 1)
  }
  for (const [position, count] of counts) {
    if (count >= 2) return position
  }
  return null
}

// Same obligation as ownBarrierTrackPosition, for a barrier formed in the player's own home
// corridor instead of the shared track - PC2.4's own rulebook text names this outright ("a double
// forces the player to open a barrier, including those in the finish zone"), and it's a real,
// reachable state now that ownPiecesInCorridor's own cap allows two of a color's own pieces to
// share a non-final corridor square (see that function's own comment). Deliberately excludes the
// final slot - a piece there is 'Finished', not 'InHomeCorridor' (a different state entirely, not
// counted here), and finished pieces are done playing regardless of how many share that square, so
// there's nothing a double could meaningfully "break" there.
export function ownCorridorBarrierPosition(player: PlayerState): number | null {
  const counts = new Map<number, number>()
  for (const piece of player.pieces) {
    if (piece.state !== 'InHomeCorridor') continue
    counts.set(piece.corridorPosition, (counts.get(piece.corridorPosition) ?? 0) + 1)
  }
  for (const [position, count] of counts) {
    if (count >= 2) return position
  }
  return null
}
