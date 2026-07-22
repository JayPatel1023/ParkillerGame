using System.Collections.Generic;
using UnityEngine;

namespace Parkiller.Core
{
    // One asset per board variant (2p-6p). Waypoints are placed by hand over the board art using the
    // Inspector tool in BoardDefinitionEditor, since each tablero has its own hand-drawn curves.
    [CreateAssetMenu(menuName = "Parkiller/Board Definition", fileName = "BoardDefinition")]
    public class BoardDefinition : ScriptableObject
    {
        public int playerCount = 4;
        public Sprite boardBackground;

        [Tooltip("Squares of the shared track, in travel order. An entry in this list IS the track index the rules engine uses.")]
        public List<Vector2> trackWaypoints = new List<Vector2>();

        [Tooltip("Track indices safe from capture - usually each lane's entry square, marked with a star on the art.")]
        public List<int> safeTrackIndices = new List<int>();

        public List<PlayerLane> playerLanes = new List<PlayerLane>();

        public BoardData ToBoardData()
        {
            var data = new BoardData
            {
                PlayerCount = playerCount,
                TrackLength = trackWaypoints.Count,
                SafeTrackIndices = new HashSet<int>(safeTrackIndices)
            };

            foreach (var lane in playerLanes)
            {
                data.Lanes[lane.color] = new PlayerLaneData
                {
                    Color = lane.color,
                    EntryTrackIndex = lane.entryTrackIndex,
                    HomeEntranceTrackIndex = lane.homeEntranceTrackIndex,
                    CorridorLength = lane.homeCorridorWaypoints.Count
                };
            }

            return data;
        }
    }

    [System.Serializable]
    public class PlayerLane
    {
        public PieceColor color;

        [Tooltip("Track index where this color's pieces enter the shared track from the yard.")]
        public int entryTrackIndex;

        [Tooltip("Last shared-track index before this color turns off into its own home corridor.")]
        public int homeEntranceTrackIndex;

        [Tooltip("Corridor squares leading to the center, in travel order. The last one is the finish square.")]
        public List<Vector2> homeCorridorWaypoints = new List<Vector2>();

        [Tooltip("The 4 waiting slots inside this color's yard circle.")]
        public List<Vector2> yardWaypoints = new List<Vector2>();
    }
}
