using UnityEngine;

namespace Parkiller.UI
{
    [RequireComponent(typeof(SpriteRenderer))]
    public class PieceView : MonoBehaviour
    {
        [SerializeField] SpriteRenderer spriteRenderer;

        void Awake()
        {
            if (!spriteRenderer)
                spriteRenderer = GetComponent<SpriteRenderer>();
        }

        public void SetColor(Color color) => spriteRenderer.color = color;

        public void MoveTo(Vector2 worldPosition) => transform.position = worldPosition;
    }
}
