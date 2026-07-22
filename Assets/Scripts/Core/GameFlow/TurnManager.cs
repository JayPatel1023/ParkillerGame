using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Parkiller.Core
{
    // Orchestrates one local (hotseat) game: whose turn it is, rolling, offering move choices, applying them.
    public class TurnManager : MonoBehaviour
    {
        public event Action<PlayerState> TurnStarted;
        public event Action<int> DiceRolled;
        public event Action<List<MoveOption>> MoveChoicesReady;
        public event Action MoveNotPossible;
        public event Action<MoveResult> MoveApplied;
        public event Action<PlayerState> GameWon;

        BoardData board;
        List<PlayerState> players;
        RuleSettings settings;
        Dice dice;

        int currentPlayerIndex;
        int consecutiveSixes;
        List<MoveOption> pendingMoves;

        public PlayerState CurrentPlayer => players[currentPlayerIndex];

        public void Initialize(BoardData board, List<PlayerState> players, RuleSettings settings, int? diceSeed = null)
        {
            this.board = board;
            this.players = players;
            this.settings = settings;
            dice = new Dice(diceSeed);
            currentPlayerIndex = 0;
            consecutiveSixes = 0;
        }

        public void StartGame()
        {
            TurnStarted?.Invoke(CurrentPlayer);
        }

        public void RequestRoll()
        {
            int roll = dice.Roll();
            DiceRolled?.Invoke(roll);

            if (roll == 6)
            {
                consecutiveSixes++;
                // Standard Spanish parchís rule: a third six in a row burns the turn entirely, no move.
                if (settings.thirdConsecutiveSixForfeitsMove && consecutiveSixes >= 3)
                {
                    consecutiveSixes = 0;
                    EndTurn(grantExtraTurn: false);
                    return;
                }
            }
            else
            {
                consecutiveSixes = 0;
            }

            pendingMoves = ParchisRules.GetValidMoves(board, CurrentPlayer, roll, settings);
            if (pendingMoves.Count == 0)
            {
                MoveNotPossible?.Invoke();
                EndTurn(grantExtraTurn: settings.grantExtraTurnOnSix && roll == 6);
                return;
            }

            MoveChoicesReady?.Invoke(pendingMoves);
        }

        public void SubmitMove(Piece chosenPiece)
        {
            var move = pendingMoves?.FirstOrDefault(m => m.Piece == chosenPiece);
            if (move == null)
                return;

            var result = ParchisRules.ApplyMove(board, move, players, settings);
            bool rolledSixThisTurn = consecutiveSixes > 0;
            pendingMoves = null;
            MoveApplied?.Invoke(result);

            if (CurrentPlayer.HasWon)
            {
                GameWon?.Invoke(CurrentPlayer);
                return;
            }

            EndTurn(grantExtraTurn: settings.grantExtraTurnOnSix && rolledSixThisTurn);
        }

        void EndTurn(bool grantExtraTurn)
        {
            if (!grantExtraTurn)
            {
                consecutiveSixes = 0;
                currentPlayerIndex = (currentPlayerIndex + 1) % players.Count;
            }
            TurnStarted?.Invoke(CurrentPlayer);
        }
    }
}
