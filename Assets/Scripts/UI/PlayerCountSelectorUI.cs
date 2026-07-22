using System.Linq;
using UnityEngine;
using Parkiller.Core;

namespace Parkiller.UI
{
    public class PlayerCountSelectorUI : MonoBehaviour
    {
        static readonly PieceColor[] DefaultColorOrder =
        {
            PieceColor.Red, PieceColor.Blue, PieceColor.Gold, PieceColor.Green, PieceColor.Purple, PieceColor.Orange
        };

        [Tooltip("Index 0 = 2-player board ... index 4 = 6-player board")]
        [SerializeField] BoardDefinition[] boardsByPlayerCount = new BoardDefinition[5];
        [SerializeField] LocalGameSession localGameSession;
        [SerializeField] BoardRenderer boardRenderer;
        [SerializeField] GameObject boardPanel;

        public void OnPlayerCountConfirmed(int playerCount)
        {
            if (playerCount < 2 || playerCount > 6)
            {
                Debug.LogError($"Parchís supports 2-6 players, got {playerCount}");
                return;
            }

            var boardDefinition = boardsByPlayerCount[playerCount - 2];
            var colors = DefaultColorOrder.Take(playerCount).ToList();

            localGameSession.BeginLocalGame(boardDefinition, colors);
            boardRenderer.Setup(boardDefinition, localGameSession.Players);

            gameObject.SetActive(false);
            boardPanel.SetActive(true);
        }
    }
}
