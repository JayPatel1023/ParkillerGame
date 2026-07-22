namespace Parkiller.Core
{
    public class Piece
    {
        public readonly PieceColor Color;
        public readonly int PieceIndex;

        public PieceState State = PieceState.InYard;
        public int TrackPosition = -1;
        public int CorridorPosition = -1;

        public Piece(PieceColor color, int pieceIndex)
        {
            Color = color;
            PieceIndex = pieceIndex;
        }
    }
}
