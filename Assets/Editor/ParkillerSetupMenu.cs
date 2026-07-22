using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using Parkiller.Core;

namespace Parkiller.EditorTools
{
    public static class ParkillerSetupMenu
    {
        const string BoardsFolder = "Assets/Art/Boards";

        static readonly Dictionary<int, PieceColor[]> LaneColorsByPlayerCount = new Dictionary<int, PieceColor[]>
        {
            { 2, new[] { PieceColor.Red, PieceColor.Blue } },
            { 3, new[] { PieceColor.Red, PieceColor.Blue, PieceColor.Gold } },
            { 4, new[] { PieceColor.Red, PieceColor.Gold, PieceColor.Green, PieceColor.Blue } },
            { 5, new[] { PieceColor.Blue, PieceColor.Gold, PieceColor.Purple, PieceColor.Green, PieceColor.Red } },
            { 6, new[] { PieceColor.Gold, PieceColor.Blue, PieceColor.Purple, PieceColor.Orange, PieceColor.Green, PieceColor.Red } },
        };

        // One-click creation of the 5 BoardDefinition assets, pre-wired to the delivered board art and
        // lane colors. Waypoints still need to be traced by hand per board using BoardDefinitionEditor.
        [MenuItem("Parkiller/Setup/Create Board Definitions")]
        public static void CreateBoardDefinitions()
        {
            foreach (var entry in LaneColorsByPlayerCount)
            {
                int playerCount = entry.Key;
                string spritePath = $"{BoardsFolder}/board_{playerCount}p.jpg";
                string assetPath = $"{BoardsFolder}/BoardDefinition_{playerCount}p.asset";

                if (AssetDatabase.LoadAssetAtPath<BoardDefinition>(assetPath) != null)
                {
                    Debug.Log($"Skipped {assetPath}, already exists.");
                    continue;
                }

                var sprite = AssetDatabase.LoadAssetAtPath<Sprite>(spritePath);
                if (sprite == null)
                    Debug.LogWarning($"No sprite found at {spritePath}. Set its Texture Type to 'Sprite (2D and UI)' in the Inspector, then re-run this menu item.");

                var board = ScriptableObject.CreateInstance<BoardDefinition>();
                board.playerCount = playerCount;
                board.boardBackground = sprite;
                foreach (var color in entry.Value)
                    board.playerLanes.Add(new PlayerLane { color = color });

                AssetDatabase.CreateAsset(board, assetPath);
            }

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("Board definitions created. Open each asset and use the waypoint placement tool in the Inspector to trace the track, yards, and home corridors over the board art.");
        }
    }
}
