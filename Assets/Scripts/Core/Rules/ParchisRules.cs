using System.Collections.Generic;

namespace Parkiller.Core
{
    public static class ParchisRules
    {
        public static List<MoveOption> GetValidMoves(BoardData board, PlayerState player, int roll, RuleSettings settings)
        {
            var moves = new List<MoveOption>();
            if (!board.Lanes.TryGetValue(player.Color, out var lane))
                return moves;

            foreach (var piece in player.Pieces)
            {
                if (piece.State == PieceState.Finished)
                    continue;

                if (piece.State == PieceState.InYard)
                {
                    if (roll == settings.entryRoll)
                    {
                        moves.Add(new MoveOption
                        {
                            Piece = piece,
                            Kind = MoveKind.ExitYard,
                            ResultingTrackPosition = lane.EntryTrackIndex
                        });
                    }
                    continue;
                }

                if (piece.State == PieceState.OnTrack)
                {
                    int distanceToHomeEntrance = Mod(lane.HomeEntranceTrackIndex - piece.TrackPosition, board.TrackLength);
                    int totalStepsToFinish = distanceToHomeEntrance + lane.CorridorLength;

                    if (roll > totalStepsToFinish)
                        continue; // overshoot past home - exact count required

                    if (roll <= distanceToHomeEntrance)
                    {
                        int newTrackPos = (piece.TrackPosition + roll) % board.TrackLength;
                        moves.Add(new MoveOption { Piece = piece, Kind = MoveKind.TrackMove, ResultingTrackPosition = newTrackPos });
                    }
                    else
                    {
                        int corridorIndex = roll - distanceToHomeEntrance - 1;
                        var kind = corridorIndex == lane.CorridorLength - 1 ? MoveKind.FinishMove : MoveKind.CorridorMove;
                        moves.Add(new MoveOption { Piece = piece, Kind = kind, ResultingCorridorPosition = corridorIndex });
                    }
                    continue;
                }

                if (piece.State == PieceState.InHomeCorridor)
                {
                    int newCorridorPos = piece.CorridorPosition + roll;
                    if (newCorridorPos > lane.CorridorLength - 1)
                        continue; // overshoot - exact count required

                    var kind = newCorridorPos == lane.CorridorLength - 1 ? MoveKind.FinishMove : MoveKind.CorridorMove;
                    moves.Add(new MoveOption { Piece = piece, Kind = kind, ResultingCorridorPosition = newCorridorPos });
                }
            }

            return moves;
        }

        public static MoveResult ApplyMove(BoardData board, MoveOption move, IReadOnlyList<PlayerState> allPlayers, RuleSettings settings)
        {
            var piece = move.Piece;
            var result = new MoveResult { MovedPiece = piece };

            switch (move.Kind)
            {
                case MoveKind.ExitYard:
                case MoveKind.TrackMove:
                    piece.State = PieceState.OnTrack;
                    piece.TrackPosition = move.ResultingTrackPosition;
                    piece.CorridorPosition = -1;
                    result.CapturedPiece = settings.captureSendsToYard ? CaptureAt(board, piece, move.ResultingTrackPosition, allPlayers) : null;
                    break;

                case MoveKind.CorridorMove:
                    piece.State = PieceState.InHomeCorridor;
                    piece.TrackPosition = -1;
                    piece.CorridorPosition = move.ResultingCorridorPosition;
                    break;

                case MoveKind.FinishMove:
                    piece.State = PieceState.Finished;
                    piece.TrackPosition = -1;
                    piece.CorridorPosition = move.ResultingCorridorPosition;
                    result.PieceFinished = true;
                    break;
            }

            return result;
        }

        static Piece CaptureAt(BoardData board, Piece mover, int trackPosition, IReadOnlyList<PlayerState> allPlayers)
        {
            if (board.SafeTrackIndices.Contains(trackPosition))
                return null;

            foreach (var opponent in allPlayers)
            {
                if (opponent.Color == mover.Color)
                    continue;

                foreach (var opponentPiece in opponent.Pieces)
                {
                    if (opponentPiece.State == PieceState.OnTrack && opponentPiece.TrackPosition == trackPosition)
                    {
                        opponentPiece.State = PieceState.InYard;
                        opponentPiece.TrackPosition = -1;
                        return opponentPiece;
                    }
                }
            }

            return null;
        }

        static int Mod(int value, int modulus) => (value % modulus + modulus) % modulus;
    }
}
