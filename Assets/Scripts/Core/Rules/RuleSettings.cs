using System;

namespace Parkiller.Core
{
    [Serializable]
    public class RuleSettings
    {
        public int entryRoll = 6;
        public bool grantExtraTurnOnSix = true;
        public bool thirdConsecutiveSixForfeitsMove = true;
        public bool captureSendsToYard = true;
    }
}
