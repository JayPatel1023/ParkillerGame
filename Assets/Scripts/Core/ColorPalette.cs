using UnityEngine;

namespace Parkiller.Core
{
    // Placeholder swatches sampled from the delivered board art; swap for exact brand values once Carlos confirms them.
    public static class ColorPalette
    {
        public static Color Get(PieceColor color) => color switch
        {
            PieceColor.Red => new Color(0.73f, 0.16f, 0.16f),
            PieceColor.Blue => new Color(0.22f, 0.42f, 0.58f),
            PieceColor.Gold => new Color(0.80f, 0.62f, 0.20f),
            PieceColor.Green => new Color(0.16f, 0.42f, 0.28f),
            PieceColor.Purple => new Color(0.45f, 0.32f, 0.62f),
            PieceColor.Orange => new Color(0.82f, 0.50f, 0.25f),
            _ => Color.white
        };
    }
}
