using System.Collections.Generic;
using UnityEngine;
using Parkiller.Core;

namespace Parkiller.UI
{
    // Draws whatever BoardDefinition it's given - fully generic across the 2p-6p variants since
    // every position comes from the asset's waypoint lists, not from hardcoded layout.
    public class BoardRenderer : MonoBehaviour
    {
        [SerializeField] SpriteRenderer boardBackground;
        [SerializeField] PieceView piecePrefab;
        [SerializeField] Transform pieceContainer;

        readonly Dictionary<Piece, PieceView> pieceViews = new Dictionary<Piece, PieceView>();
        BoardDefinition definition;

        public void Setup(BoardDefinition boardDefinition, IEnumerable<PlayerState> players)
        {
            definition = boardDefinition;
            boardBackground.sprite = boardDefinition.boardBackground;

            foreach (var view in pieceViews.Values)
                Destroy(view.gameObject);
            pieceViews.Clear();

            var lanesByColor = new Dictionary<PieceColor, PlayerLane>();
            foreach (var lane in boardDefinition.playerLanes)
                lanesByColor[lane.color] = lane;

            foreach (var player in players)
            {
                var lane = lanesByColor[player.Color];
                for (int i = 0; i < player.Pieces.Length; i++)
                {
                    var piece = player.Pieces[i];
                    var view = Instantiate(piecePrefab, pieceContainer);
                    view.SetColor(ColorPalette.Get(player.Color));
                    view.MoveTo(lane.yardWaypoints[i]);
                    pieceViews[piece] = view;
                }
            }
        }

        public void RefreshPiece(Piece piece)
        {
            if (!pieceViews.TryGetValue(piece, out var view))
                return;

            var lane = FindLane(piece.Color);
            Vector2 worldPos = piece.State switch
            {
                PieceState.InYard => lane.yardWaypoints[piece.PieceIndex],
                PieceState.OnTrack => definition.trackWaypoints[piece.TrackPosition],
                PieceState.InHomeCorridor => lane.homeCorridorWaypoints[piece.CorridorPosition],
                PieceState.Finished => lane.homeCorridorWaypoints[lane.homeCorridorWaypoints.Count - 1],
                _ => view.transform.position
            };
            view.MoveTo(worldPos);
        }

        PlayerLane FindLane(PieceColor color)
        {
            foreach (var lane in definition.playerLanes)
                if (lane.color == color)
                    return lane;
            return null;
        }
    }
}
