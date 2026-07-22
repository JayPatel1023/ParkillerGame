using System;

namespace Parkiller.Core
{
    public class Dice
    {
        readonly Random rng;

        // Accepts a seed so tests and replays can get deterministic rolls.
        public Dice(int? seed = null)
        {
            rng = seed.HasValue ? new Random(seed.Value) : new Random();
        }

        public int Roll() => rng.Next(1, 7);
    }
}
