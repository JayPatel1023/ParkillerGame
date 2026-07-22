using UnityEditor;
using UnityEngine;
using Parkiller.Core;

namespace Parkiller.EditorTools
{
    // Lets you trace a board's track/yards/corridors by clicking directly over the art in the Scene view,
    // instead of hand-typing Vector2 coordinates. This is the "traje a medida" step for each tablero.
    [CustomEditor(typeof(BoardDefinition))]
    public class BoardDefinitionEditor : Editor
    {
        enum PlacementTarget { None, Track, Yard, Corridor }

        PlacementTarget placing = PlacementTarget.None;
        int placingLaneIndex = -1;

        public override void OnInspectorGUI()
        {
            DrawDefaultInspector();

            var board = (BoardDefinition)target;

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Waypoint placement (click in Scene view over the board art)", EditorStyles.boldLabel);

            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button(placing == PlacementTarget.Track ? "Stop placing track" : "Place track waypoints"))
                    TogglePlacement(PlacementTarget.Track, -1);
                if (GUILayout.Button("Clear track"))
                {
                    Undo.RecordObject(board, "Clear Track Waypoints");
                    board.trackWaypoints.Clear();
                    EditorUtility.SetDirty(board);
                }
            }

            for (int i = 0; i < board.playerLanes.Count; i++)
            {
                var lane = board.playerLanes[i];
                EditorGUILayout.LabelField($"{lane.color} lane", EditorStyles.boldLabel);
                using (new EditorGUILayout.HorizontalScope())
                {
                    bool placingYard = placing == PlacementTarget.Yard && placingLaneIndex == i;
                    bool placingCorridor = placing == PlacementTarget.Corridor && placingLaneIndex == i;
                    if (GUILayout.Button(placingYard ? "Stop placing yard" : "Place yard slots (4)"))
                        TogglePlacement(PlacementTarget.Yard, i);
                    if (GUILayout.Button(placingCorridor ? "Stop placing corridor" : "Place home corridor"))
                        TogglePlacement(PlacementTarget.Corridor, i);
                }
            }

            if (placing != PlacementTarget.None)
                EditorGUILayout.HelpBox("Click on the board in the Scene view to add the next waypoint, in travel order. Esc or the button again to stop.", MessageType.Info);
        }

        void TogglePlacement(PlacementTarget target, int laneIndex)
        {
            if (placing == target && placingLaneIndex == laneIndex)
            {
                placing = PlacementTarget.None;
                placingLaneIndex = -1;
            }
            else
            {
                placing = target;
                placingLaneIndex = laneIndex;
            }
            SceneView.RepaintAll();
        }

        void OnSceneGUI()
        {
            var board = (BoardDefinition)target;
            DrawExistingWaypoints(board);

            if (placing == PlacementTarget.None)
                return;

            HandleUtility.AddDefaultControl(GUIUtility.GetControlID(FocusType.Passive));
            Event e = Event.current;

            if (e.type == EventType.KeyDown && e.keyCode == KeyCode.Escape)
            {
                placing = PlacementTarget.None;
                placingLaneIndex = -1;
                e.Use();
                return;
            }

            if (e.type == EventType.MouseDown && e.button == 0)
            {
                Vector3 worldPoint = HandleUtility.GUIPointToWorldRay(e.mousePosition).origin;
                Vector2 point = new Vector2(worldPoint.x, worldPoint.y);

                Undo.RecordObject(board, "Add Waypoint");
                switch (placing)
                {
                    case PlacementTarget.Track:
                        board.trackWaypoints.Add(point);
                        break;
                    case PlacementTarget.Yard:
                        var yardSlots = board.playerLanes[placingLaneIndex].yardWaypoints;
                        if (yardSlots.Count < 4)
                            yardSlots.Add(point);
                        break;
                    case PlacementTarget.Corridor:
                        board.playerLanes[placingLaneIndex].homeCorridorWaypoints.Add(point);
                        break;
                }
                EditorUtility.SetDirty(board);
                e.Use();
            }
        }

        void DrawExistingWaypoints(BoardDefinition board)
        {
            Handles.color = Color.cyan;
            for (int i = 0; i < board.trackWaypoints.Count; i++)
            {
                var p = board.trackWaypoints[i];
                Handles.DrawSolidDisc(p, Vector3.forward, HandleUtility.GetHandleSize(p) * 0.05f);
                Handles.Label(p, i.ToString());
            }

            foreach (var lane in board.playerLanes)
            {
                Handles.color = ColorPalette.Get(lane.color);
                foreach (var p in lane.yardWaypoints)
                    Handles.DrawSolidDisc(p, Vector3.forward, HandleUtility.GetHandleSize(p) * 0.05f);
                foreach (var p in lane.homeCorridorWaypoints)
                    Handles.DrawSolidDisc(p, Vector3.forward, HandleUtility.GetHandleSize(p) * 0.05f);
            }
        }
    }
}
