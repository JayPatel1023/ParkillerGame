using UnityEngine;
using UnityEngine.UI;

namespace Parkiller.UI
{
    public class StartScreenController : MonoBehaviour
    {
        [Header("Branding - replace once Carlos sends the final logo/brand colors")]
        [SerializeField] Image logoImage;
        [SerializeField] Image backgroundPanel;
        [SerializeField] Color brandPrimary = new Color(0.71f, 0.80f, 0.73f); // parchment/sage sampled from the board art
        [SerializeField] Color brandAccent = new Color(0.80f, 0.62f, 0.20f);  // gold trim sampled from the board art

        [Header("Navigation")]
        [SerializeField] Button playLocalButton;
        [SerializeField] Button playOnlineButton;
        [SerializeField] GameObject playerCountSelectorPanel;

        void Awake()
        {
            ApplyBrandColors();

            playOnlineButton.interactable = false; // wired up in milestone 2 (Photon)
            playLocalButton.onClick.AddListener(OpenPlayerCountSelector);
        }

        void ApplyBrandColors()
        {
            if (backgroundPanel) backgroundPanel.color = brandPrimary;
            if (playLocalButton && playLocalButton.image) playLocalButton.image.color = brandAccent;
        }

        void OpenPlayerCountSelector()
        {
            playerCountSelectorPanel.SetActive(true);
            gameObject.SetActive(false);
        }
    }
}
