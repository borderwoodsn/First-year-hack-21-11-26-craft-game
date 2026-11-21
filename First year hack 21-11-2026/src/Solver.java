import java.util.*;

/**
 * Works out recipes through the combination graph. Used for:
 *  - hints:      "what should I combine next to get closer to the target?"
 *  - par:        roughly the fewest combinations needed to reach a song from the starters
 *  - validation: warn at startup if a target song can't be reached at all
 */
public class Solver {
    private final List<Database.Combination> combos;

    public Solver(List<Database.Combination> combos) {
        this.combos = combos;
    }

    /**
     * For every element reachable from {@code known}, finds the cheapest combination that makes it.
     * Cost of an element = cost(first) + cost(second) + 1, with known elements costing 0.
     * Repeats until nothing improves (a simple Bellman-Ford style relaxation).
     */
    private Map<String, Database.Combination> bestRecipes(Set<String> known) {
        Map<String, Integer> cost = new HashMap<>();
        for (String k : known) cost.put(k, 0);
        Map<String, Database.Combination> best = new HashMap<>();
        boolean changed = true;
        while (changed) {
            changed = false;
            for (Database.Combination c : combos) {
                Integer ca = cost.get(c.first());
                Integer cb = cost.get(c.second());
                if (ca == null || cb == null) continue;
                int newCost = ca + cb + 1;
                Integer current = cost.get(c.result());
                if (current == null || newCost < current) {
                    cost.put(c.result(), newCost);
                    best.put(c.result(), c);
                    changed = true;
                }
            }
        }
        return best;
    }

    /**
     * The next combination a player should try, using only things they already have.
     * Empty if they already have the target or it can't be reached.
     */
    public Optional<Database.Combination> hint(String target, Set<String> known) {
        if (known.contains(target)) return Optional.empty();
        Map<String, Database.Combination> best = bestRecipes(known);
        if (!best.containsKey(target)) return Optional.empty();
        // Walk down the recipe tree until we find a step whose ingredients are both known.
        String current = target;
        while (true) {
            Database.Combination step = best.get(current);
            boolean haveFirst = known.contains(step.first());
            boolean haveSecond = known.contains(step.second());
            if (haveFirst && haveSecond) return Optional.of(step);
            current = haveFirst ? step.second() : step.first();
        }
    }

    /** Ordered list of combinations that builds the target from {@code known}. Empty if unreachable. */
    public List<Database.Combination> solution(String target, Set<String> known) {
        Map<String, Database.Combination> best = bestRecipes(known);
        List<Database.Combination> steps = new ArrayList<>();
        if (known.contains(target) || best.containsKey(target)) {
            collect(target, known, best, new HashSet<>(), steps);
        }
        return steps;
    }

    private void collect(String element, Set<String> known, Map<String, Database.Combination> best,
                         Set<String> done, List<Database.Combination> steps) {
        if (known.contains(element) || !done.add(element)) return;
        Database.Combination c = best.get(element);
        collect(c.first(), known, best, done, steps);
        collect(c.second(), known, best, done, steps);
        steps.add(c);
    }

    /** Number of combinations in the solution from the starters, or -1 if the song is unreachable. */
    public int par(String target, Set<String> starters) {
        List<Database.Combination> steps = solution(target, starters);
        return steps.isEmpty() ? -1 : steps.size();
    }
}
