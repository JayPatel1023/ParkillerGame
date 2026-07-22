using System.Collections.Generic;
using NUnit.Framework;
using Parkiller.Core;

public class ParchisRulesTests
{
    static BoardData BuildTestBoard()
    {
        var board = new BoardData { TrackLength = 20, PlayerCount = 2 };
        board.Lanes[PieceColor.Red] = new PlayerLaneData { Color = PieceColor.Red, EntryTrackIndex = 0, HomeEntranceTrackIndex = 19, CorridorLength = 4 };
        board.Lanes[PieceColor.Blue] = new PlayerLaneData { Color = PieceColor.Blue, EntryTrackIndex = 10, HomeEntranceTrackIndex = 9, CorridorLength = 4 };
        board.SafeTrackIndices = new HashSet<int> { 0, 10 };
        return board;
    }

    [Test]
    public void PieceInYard_CannotMove_WithoutEntryRoll()
    {
        var board = BuildTestBoard();
        var player = new PlayerState(PieceColor.Red);
        var settings = new RuleSettings();

        var moves = ParchisRules.GetValidMoves(board, player, 4, settings);

        Assert.IsEmpty(moves);
    }

    [Test]
    public void PieceInYard_CanExit_WithSix()
    {
        var board = BuildTestBoard();
        var player = new PlayerState(PieceColor.Red);
        var settings = new RuleSettings();

        var moves = ParchisRules.GetValidMoves(board, player, 6, settings);

        Assert.AreEqual(4, moves.Count);
        Assert.AreEqual(MoveKind.ExitYard, moves[0].Kind);
        Assert.AreEqual(0, moves[0].ResultingTrackPosition);
    }

    [Test]
    public void LandingOnOpponent_OnUnsafeSquare_CapturesIt()
    {
        var board = BuildTestBoard();
        var attacker = new PlayerState(PieceColor.Red);
        var defender = new PlayerState(PieceColor.Blue);

        defender.Pieces[0].State = PieceState.OnTrack;
        defender.Pieces[0].TrackPosition = 3;

        attacker.Pieces[0].State = PieceState.OnTrack;
        attacker.Pieces[0].TrackPosition = 0;

        var settings = new RuleSettings();
        var move = ParchisRules.GetValidMoves(board, attacker, 3, settings)[0];
        var result = ParchisRules.ApplyMove(board, move, new List<PlayerState> { attacker, defender }, settings);

        Assert.AreEqual(defender.Pieces[0], result.CapturedPiece);
        Assert.AreEqual(PieceState.InYard, defender.Pieces[0].State);
    }

    [Test]
    public void LandingOnOpponent_OnSafeSquare_DoesNotCapture()
    {
        var board = BuildTestBoard();
        var attacker = new PlayerState(PieceColor.Red);
        var defender = new PlayerState(PieceColor.Blue);

        defender.Pieces[0].State = PieceState.OnTrack;
        defender.Pieces[0].TrackPosition = 10; // a safe square

        attacker.Pieces[0].State = PieceState.OnTrack;
        attacker.Pieces[0].TrackPosition = 7;

        var settings = new RuleSettings();
        var move = ParchisRules.GetValidMoves(board, attacker, 3, settings)[0];
        var result = ParchisRules.ApplyMove(board, move, new List<PlayerState> { attacker, defender }, settings);

        Assert.IsNull(result.CapturedPiece);
        Assert.AreEqual(PieceState.OnTrack, defender.Pieces[0].State);
    }

    [Test]
    public void ExactRollToFinish_FinishesPiece()
    {
        var board = BuildTestBoard();
        var player = new PlayerState(PieceColor.Red);
        player.Pieces[0].State = PieceState.InHomeCorridor;
        player.Pieces[0].CorridorPosition = 1; // 2 steps from the last corridor square (index 3)

        var settings = new RuleSettings();
        var moves = ParchisRules.GetValidMoves(board, player, 2, settings);

        Assert.AreEqual(1, moves.Count);
        Assert.AreEqual(MoveKind.FinishMove, moves[0].Kind);

        var result = ParchisRules.ApplyMove(board, moves[0], new List<PlayerState> { player }, settings);
        Assert.IsTrue(result.PieceFinished);
        Assert.AreEqual(PieceState.Finished, player.Pieces[0].State);
    }

    [Test]
    public void Overshoot_PastFinish_IsNotAValidMove()
    {
        var board = BuildTestBoard();
        var player = new PlayerState(PieceColor.Red);
        player.Pieces[0].State = PieceState.InHomeCorridor;
        player.Pieces[0].CorridorPosition = 2; // 1 step from finish

        var settings = new RuleSettings();
        var moves = ParchisRules.GetValidMoves(board, player, 5, settings);

        Assert.IsEmpty(moves);
    }

    [Test]
    public void PlayerWithAllPiecesFinished_HasWon()
    {
        var player = new PlayerState(PieceColor.Red);
        foreach (var piece in player.Pieces)
            piece.State = PieceState.Finished;

        Assert.IsTrue(player.HasWon);
    }
}
