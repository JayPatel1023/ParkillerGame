namespace Parkiller.Core
{
    public class PlayerState
    {
        public readonly PieceColor Color;
        public readonly Piece[] Pieces = new Piece[4];

        public PlayerState(PieceColor color)
        {
            Color = color;
            for (int i = 0; i < Pieces.Length; i++)
                Pieces[i] = new Piece(color, i);
        }

        public bool HasWon
        {
            get
            {
                foreach (var piece in Pieces)
                    if (piece.State != PieceState.Finished)
                        return false;
                return true;
            }
        }
    }
}
