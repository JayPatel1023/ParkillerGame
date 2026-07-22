namespace Parkiller.Core
{
    public enum MoveKind
    {
        ExitYard,
        TrackMove,
        CorridorMove,
        FinishMove
    }

    public class MoveOption
    {
        public Piece Piece;
        public MoveKind Kind;
        public int ResultingTrackPosition = -1;
        public int ResultingCorridorPosition = -1;
    }

    public class MoveResult
    {
        public Piece MovedPiece;
        public Piece CapturedPiece;
        public bool PieceFinished;
    }
}
