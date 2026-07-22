using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Parkiller.Core
{
    // Entry point for milestone 1: same-device hotseat play, 2-6 real players, no networking, no bots.
    public class LocalGameSession : MonoBehaviour
    {
        [SerializeField] TurnManager turnManager;

        public BoardData ActiveBoard { get; private set; }
        public List<PlayerState> Players { get; private set; }

        public void BeginLocalGame(BoardDefinition boardDefinition, List<PieceColor> participatingColors)
        {
            ActiveBoard = boardDefinition.ToBoardData();
            Players = participatingColors.Select(c => new PlayerState(c)).ToList();

            turnManager.Initialize(ActiveBoard, Players, new RuleSettings());
            turnManager.StartGame();
        }
    }
}
