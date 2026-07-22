using System.Collections.Generic;

namespace Parkiller.Core
{
    public class PlayerLaneData
    {
        public PieceColor Color;
        public int EntryTrackIndex;
        public int HomeEntranceTrackIndex;
        public int CorridorLength;
    }

    // Engine-independent board description consumed by ParchisRules. Produced from a BoardDefinition asset.
    public class BoardData
    {
        public int PlayerCount;
        public int TrackLength;
        public Dictionary<PieceColor, PlayerLaneData> Lanes = new Dictionary<PieceColor, PlayerLaneData>();
        public HashSet<int> SafeTrackIndices = new HashSet<int>();
    }
}
