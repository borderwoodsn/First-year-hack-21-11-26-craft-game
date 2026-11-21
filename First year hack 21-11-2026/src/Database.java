import java.sql.*;
import java.util.*;

/**
 * Everything that touches the SQLite database (game.db).
 *
 * Tables:
 *   modes         the game modes (Music, Film, ...)
 *   elements      every craftable thing in each mode (and whether it's a starting block)
 *   combinations  first + second = result (stored with first_id <= second_id so order doesn't matter)
 *   targets       the songs/films players try to reach
 *   scores        leaderboard entries
 */
public class Database implements AutoCloseable {

    public record Mode(String id, String name, String emoji, String noun) {
        public Map<String, Object> toJson() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id);
            m.put("name", name);
            m.put("emoji", emoji);
            m.put("noun", noun);
            return m;
        }
    }

    public record Element(int id, String name, String emoji, boolean starter) {
        public Map<String, Object> toJson() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", name);
            m.put("emoji", emoji);
            return m;
        }
    }

    public record Target(Element element, String creator, int year, String fact) {}

    public record Combination(String first, String second, String result) {}

    public record Score(String player, String target, int moves, int seconds, String createdAt) {}

    /** A combination a player suggested in-game, waiting for the host to approve or reject it. */
    public record Suggestion(int id, String mode, String first, String second, String result, String emoji,
                             String player, int votes, String status, String createdAt) {
        public Map<String, Object> toJson() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id);
            m.put("mode", mode);
            m.put("first", first);
            m.put("second", second);
            m.put("result", result);
            m.put("emoji", emoji);
            m.put("player", player);
            m.put("votes", votes);
            m.put("status", status);
            m.put("date", createdAt);
            return m;
        }
    }

    private final Connection conn;

    public Database(String file) throws SQLException {
        conn = DriverManager.getConnection("jdbc:sqlite:" + file);
        try (Statement st = conn.createStatement()) {
            st.execute("PRAGMA foreign_keys = ON");

            // Upgrade from the first version (music only, no "mode" column). Those tables are
            // rebuilt from data/ on every start anyway, so it's safe to drop them. Scores are kept.
            if (tableExists("elements") && !columnExists("elements", "mode")) {
                st.execute("DROP TABLE IF EXISTS combinations");
                st.execute("DROP TABLE IF EXISTS targets");
                st.execute("DROP TABLE IF EXISTS elements");
            }

            st.execute("""
                CREATE TABLE IF NOT EXISTS modes (
                    id         TEXT    PRIMARY KEY,
                    name       TEXT    NOT NULL,
                    emoji      TEXT    NOT NULL,
                    noun       TEXT    NOT NULL,
                    sort_order INTEGER NOT NULL
                )""");
            st.execute("""
                CREATE TABLE IF NOT EXISTS elements (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    mode       TEXT    NOT NULL REFERENCES modes(id) ON DELETE CASCADE,
                    name       TEXT    NOT NULL COLLATE NOCASE,
                    emoji      TEXT    NOT NULL,
                    is_starter INTEGER NOT NULL DEFAULT 0,
                    UNIQUE (mode, name)
                )""");
            st.execute("""
                CREATE TABLE IF NOT EXISTS combinations (
                    first_id  INTEGER NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
                    second_id INTEGER NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
                    result_id INTEGER NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
                    PRIMARY KEY (first_id, second_id),
                    CHECK (first_id <= second_id)
                )""");
            st.execute("""
                CREATE TABLE IF NOT EXISTS targets (
                    element_id INTEGER PRIMARY KEY REFERENCES elements(id) ON DELETE CASCADE,
                    creator    TEXT    NOT NULL,
                    year       INTEGER NOT NULL,
                    fact       TEXT    NOT NULL,
                    sort_order INTEGER NOT NULL
                )""");
            // Scores store the mode and target name (not ids) so they survive re-seeding the game data.
            st.execute("""
                CREATE TABLE IF NOT EXISTS scores (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    mode       TEXT    NOT NULL DEFAULT 'music',
                    player     TEXT    NOT NULL,
                    target     TEXT    NOT NULL,
                    moves      INTEGER NOT NULL,
                    seconds    INTEGER NOT NULL,
                    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
                )""");
            // Daily challenge results: one leaderboard per mode per day, ranked by time.
            st.execute("""
                CREATE TABLE IF NOT EXISTS suggestions (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    mode       TEXT    NOT NULL,
                    first      TEXT    NOT NULL,
                    second     TEXT    NOT NULL,
                    result     TEXT    NOT NULL,
                    emoji      TEXT    NOT NULL,
                    player     TEXT,
                    votes      INTEGER NOT NULL DEFAULT 1,
                    status     TEXT    NOT NULL DEFAULT 'pending',
                    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
                )""");
            st.execute("""
                CREATE TABLE IF NOT EXISTS rush_scores (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    mode       TEXT    NOT NULL,
                    player     TEXT    NOT NULL,
                    score      INTEGER NOT NULL,
                    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
                )""");
            st.execute("""
                CREATE TABLE IF NOT EXISTS daily_scores (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    mode       TEXT    NOT NULL,
                    day        TEXT    NOT NULL,
                    player     TEXT    NOT NULL,
                    target     TEXT    NOT NULL,
                    moves      INTEGER NOT NULL,
                    seconds    INTEGER NOT NULL,
                    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
                )""");
            if (!columnExists("scores", "mode")) {
                // Scores saved before Film mode existed were all Music scores.
                st.execute("ALTER TABLE scores ADD COLUMN mode TEXT NOT NULL DEFAULT 'music'");
            }
        }
    }

    private boolean tableExists(String table) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")) {
            ps.setString(1, table);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    private boolean columnExists(String table, String column) throws SQLException {
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("PRAGMA table_info(" + table + ")")) {
            while (rs.next()) {
                if (rs.getString("name").equalsIgnoreCase(column)) return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------------------ seeding

    /** Element definition read from the data files. */
    public record ElementDef(String name, String emoji, boolean starter) {}

    /** Target definition read from the data files. */
    public record TargetDef(String name, String creator, int year, String fact) {}

    /** Everything read from one data/<mode>/ folder. */
    public record ModeData(Mode mode, Collection<ElementDef> elements,
                           Collection<Combination> combinations, List<TargetDef> targets) {}

    /** Replaces all game data (modes, elements, combinations, targets) in one transaction. Scores are kept. */
    public synchronized void replaceGameData(List<ModeData> modes) throws SQLException {
        conn.setAutoCommit(false);
        try (Statement st = conn.createStatement()) {
            st.execute("DELETE FROM combinations");
            st.execute("DELETE FROM targets");
            st.execute("DELETE FROM elements");
            st.execute("DELETE FROM modes");

            int modeOrder = 0;
            for (ModeData data : modes) {
                Mode mode = data.mode();
                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO modes (id, name, emoji, noun, sort_order) VALUES (?, ?, ?, ?, ?)")) {
                    ps.setString(1, mode.id());
                    ps.setString(2, mode.name());
                    ps.setString(3, mode.emoji());
                    ps.setString(4, mode.noun());
                    ps.setInt(5, modeOrder++);
                    ps.executeUpdate();
                }

                Map<String, Integer> ids = new HashMap<>();
                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO elements (mode, name, emoji, is_starter) VALUES (?, ?, ?, ?)",
                        Statement.RETURN_GENERATED_KEYS)) {
                    for (ElementDef e : data.elements()) {
                        ps.setString(1, mode.id());
                        ps.setString(2, e.name());
                        ps.setString(3, e.emoji());
                        ps.setInt(4, e.starter() ? 1 : 0);
                        ps.executeUpdate();
                        try (ResultSet keys = ps.getGeneratedKeys()) {
                            keys.next();
                            ids.put(e.name().toLowerCase(), keys.getInt(1));
                        }
                    }
                }

                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO combinations (first_id, second_id, result_id) VALUES (?, ?, ?)")) {
                    for (Combination c : data.combinations()) {
                        int a = ids.get(c.first().toLowerCase());
                        int b = ids.get(c.second().toLowerCase());
                        ps.setInt(1, Math.min(a, b));
                        ps.setInt(2, Math.max(a, b));
                        ps.setInt(3, ids.get(c.result().toLowerCase()));
                        ps.executeUpdate();
                    }
                }

                try (PreparedStatement ps = conn.prepareStatement(
                        "INSERT INTO targets (element_id, creator, year, fact, sort_order) VALUES (?, ?, ?, ?, ?)")) {
                    int order = 0;
                    for (TargetDef t : data.targets()) {
                        ps.setInt(1, ids.get(t.name().toLowerCase()));
                        ps.setString(2, t.creator());
                        ps.setInt(3, t.year());
                        ps.setString(4, t.fact());
                        ps.setInt(5, order++);
                        ps.executeUpdate();
                    }
                }
            }
            conn.commit();
        } catch (SQLException | RuntimeException e) {
            conn.rollback();
            throw e;
        } finally {
            conn.setAutoCommit(true);
        }
    }

    // ------------------------------------------------------------------ queries

    private static Element readElement(ResultSet rs) throws SQLException {
        return new Element(rs.getInt("id"), rs.getString("name"), rs.getString("emoji"), rs.getInt("is_starter") == 1);
    }

    public synchronized List<Mode> modes() throws SQLException {
        List<Mode> list = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement("SELECT * FROM modes ORDER BY sort_order");
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                list.add(new Mode(rs.getString("id"), rs.getString("name"), rs.getString("emoji"), rs.getString("noun")));
            }
        }
        return list;
    }

    public synchronized boolean modeExists(String mode) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("SELECT 1 FROM modes WHERE id = ?")) {
            ps.setString(1, mode);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    public synchronized List<Element> starters(String mode) throws SQLException {
        List<Element> list = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT * FROM elements WHERE mode = ? AND is_starter = 1 ORDER BY id")) {
            ps.setString(1, mode);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) list.add(readElement(rs));
            }
        }
        return list;
    }

    public synchronized Optional<Element> findElement(String mode, String name) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("SELECT * FROM elements WHERE mode = ? AND name = ?")) {
            ps.setString(1, mode);
            ps.setString(2, name);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(readElement(rs)) : Optional.empty();
            }
        }
    }

    /** Looks up what two elements make together. Empty if they don't combine. */
    public synchronized Optional<Element> combine(String mode, String first, String second) throws SQLException {
        Optional<Element> a = findElement(mode, first);
        Optional<Element> b = findElement(mode, second);
        if (a.isEmpty() || b.isEmpty()) return Optional.empty();
        int lo = Math.min(a.get().id(), b.get().id());
        int hi = Math.max(a.get().id(), b.get().id());
        try (PreparedStatement ps = conn.prepareStatement("""
                SELECT e.* FROM combinations c
                JOIN elements e ON e.id = c.result_id
                WHERE c.first_id = ? AND c.second_id = ?""")) {
            ps.setInt(1, lo);
            ps.setInt(2, hi);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(readElement(rs)) : Optional.empty();
            }
        }
    }

    public synchronized List<Target> targets(String mode) throws SQLException {
        List<Target> list = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement("""
                SELECT e.*, t.creator, t.year, t.fact FROM targets t
                JOIN elements e ON e.id = t.element_id
                WHERE e.mode = ?
                ORDER BY t.sort_order""")) {
            ps.setString(1, mode);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    list.add(new Target(readElement(rs), rs.getString("creator"), rs.getInt("year"), rs.getString("fact")));
                }
            }
        }
        return list;
    }

    public synchronized List<Combination> allCombinations(String mode) throws SQLException {
        List<Combination> list = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement("""
                SELECT a.name AS first, b.name AS second, r.name AS result FROM combinations c
                JOIN elements a ON a.id = c.first_id
                JOIN elements b ON b.id = c.second_id
                JOIN elements r ON r.id = c.result_id
                WHERE r.mode = ?""")) {
            ps.setString(1, mode);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) list.add(new Combination(rs.getString("first"), rs.getString("second"), rs.getString("result")));
            }
        }
        return list;
    }

    public synchronized int countElements(String mode) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("SELECT COUNT(*) FROM elements WHERE mode = ?")) {
            ps.setString(1, mode);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.getInt(1);
            }
        }
    }

    public synchronized void addScore(String mode, String player, String target, int moves, int seconds) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "INSERT INTO scores (mode, player, target, moves, seconds) VALUES (?, ?, ?, ?, ?)")) {
            ps.setString(1, mode);
            ps.setString(2, player);
            ps.setString(3, target);
            ps.setInt(4, moves);
            ps.setInt(5, seconds);
            ps.executeUpdate();
        }
    }

    /** Best scores for a target: fewest moves first, then fastest. */
    public synchronized List<Score> topScores(String mode, String target, int limit) throws SQLException {
        List<Score> list = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement("""
                SELECT player, target, moves, seconds, created_at FROM scores
                WHERE mode = ? AND target = ? COLLATE NOCASE
                ORDER BY moves ASC, seconds ASC, id ASC
                LIMIT ?""")) {
            ps.setString(1, mode);
            ps.setString(2, target);
            ps.setInt(3, limit);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    list.add(new Score(rs.getString("player"), rs.getString("target"),
                            rs.getInt("moves"), rs.getInt("seconds"), rs.getString("created_at")));
                }
            }
        }
        return list;
    }

    // ------------------------------------------------------------------ daily challenge

    // ------------------------------------------------------------------ adding game data while running

    /** Adds a new element to a mode (used when the host approves a suggestion). */
    public synchronized void addElement(String mode, String name, String emoji) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "INSERT INTO elements (mode, name, emoji, is_starter) VALUES (?, ?, ?, 0)")) {
            ps.setString(1, mode);
            ps.setString(2, name);
            ps.setString(3, emoji);
            ps.executeUpdate();
        }
    }

    /** Adds a new combination between existing elements. */
    public synchronized void addCombination(String mode, String first, String second, String result) throws SQLException {
        Element a = findElement(mode, first).orElseThrow(() -> new IllegalArgumentException("Unknown element: " + first));
        Element b = findElement(mode, second).orElseThrow(() -> new IllegalArgumentException("Unknown element: " + second));
        Element r = findElement(mode, result).orElseThrow(() -> new IllegalArgumentException("Unknown element: " + result));
        try (PreparedStatement ps = conn.prepareStatement(
                "INSERT INTO combinations (first_id, second_id, result_id) VALUES (?, ?, ?)")) {
            ps.setInt(1, Math.min(a.id(), b.id()));
            ps.setInt(2, Math.max(a.id(), b.id()));
            ps.setInt(3, r.id());
            ps.executeUpdate();
        }
    }

    // ------------------------------------------------------------------ player suggestions

    /** Saves a suggestion. If someone already suggested the same thing, it gets an extra vote instead. */
    public synchronized void addSuggestion(String mode, String first, String second, String result, String emoji,
                                           String player) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("""
                SELECT id FROM suggestions
                WHERE mode = ? AND status = 'pending' AND result = ? COLLATE NOCASE
                  AND ((first = ? COLLATE NOCASE AND second = ? COLLATE NOCASE)
                    OR (first = ? COLLATE NOCASE AND second = ? COLLATE NOCASE))""")) {
            ps.setString(1, mode);
            ps.setString(2, result);
            ps.setString(3, first);
            ps.setString(4, second);
            ps.setString(5, second);
            ps.setString(6, first);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    try (PreparedStatement up = conn.prepareStatement("UPDATE suggestions SET votes = votes + 1 WHERE id = ?")) {
                        up.setInt(1, rs.getInt(1));
                        up.executeUpdate();
                    }
                    return;
                }
            }
        }
        try (PreparedStatement ps = conn.prepareStatement(
                "INSERT INTO suggestions (mode, first, second, result, emoji, player) VALUES (?, ?, ?, ?, ?, ?)")) {
            ps.setString(1, mode);
            ps.setString(2, first);
            ps.setString(3, second);
            ps.setString(4, result);
            ps.setString(5, emoji);
            ps.setString(6, player);
            ps.executeUpdate();
        }
    }

    private static Suggestion readSuggestion(ResultSet rs) throws SQLException {
        return new Suggestion(rs.getInt("id"), rs.getString("mode"), rs.getString("first"), rs.getString("second"),
                rs.getString("result"), rs.getString("emoji"), rs.getString("player"), rs.getInt("votes"),
                rs.getString("status"), rs.getString("created_at"));
    }

    /** Suggestions with a status ("pending", "approved", "rejected"), most-voted first. */
    public synchronized List<Suggestion> suggestions(String status) throws SQLException {
        List<Suggestion> list = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT * FROM suggestions WHERE status = ? ORDER BY votes DESC, id ASC LIMIT 300")) {
            ps.setString(1, status);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) list.add(readSuggestion(rs));
            }
        }
        return list;
    }

    public synchronized Optional<Suggestion> suggestion(int id) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("SELECT * FROM suggestions WHERE id = ?")) {
            ps.setInt(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(readSuggestion(rs)) : Optional.empty();
            }
        }
    }

    public synchronized void setSuggestionStatus(int id, String status) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("UPDATE suggestions SET status = ? WHERE id = ?")) {
            ps.setString(1, status);
            ps.setInt(2, id);
            ps.executeUpdate();
        }
    }

    /** Once a pair has a result, other pending suggestions for that same pair are no longer needed. */
    public synchronized void closeSuggestionsForPair(String mode, String first, String second) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement("""
                UPDATE suggestions SET status = 'replaced'
                WHERE mode = ? AND status = 'pending'
                  AND ((first = ? COLLATE NOCASE AND second = ? COLLATE NOCASE)
                    OR (first = ? COLLATE NOCASE AND second = ? COLLATE NOCASE))""")) {
            ps.setString(1, mode);
            ps.setString(2, first);
            ps.setString(3, second);
            ps.setString(4, second);
            ps.setString(5, first);
            ps.executeUpdate();
        }
    }

    // ------------------------------------------------------------------ rush mode

    public synchronized void addRushScore(String mode, String player, int score) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "INSERT INTO rush_scores (mode, player, score) VALUES (?, ?, ?)")) {
            ps.setString(1, mode);
            ps.setString(2, player);
            ps.setInt(3, score);
            ps.executeUpdate();
        }
    }

    /** Rush leaderboard: highest score first; ties go to whoever got there first. */
    public synchronized List<Map<String, Object>> topRushScores(String mode, int limit) throws SQLException {
        List<Map<String, Object>> list = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT player, score, created_at FROM rush_scores WHERE mode = ? ORDER BY score DESC, id ASC LIMIT ?")) {
            ps.setString(1, mode);
            ps.setInt(2, limit);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("player", rs.getString("player"));
                    m.put("score", rs.getInt("score"));
                    m.put("date", rs.getString("created_at"));
                    list.add(m);
                }
            }
        }
        return list;
    }

    // ------------------------------------------------------------------ daily challenge (scores)

    public synchronized void addDailyScore(String mode, String day, String player, String target,
                                           int moves, int seconds) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(
                "INSERT INTO daily_scores (mode, day, player, target, moves, seconds) VALUES (?, ?, ?, ?, ?, ?)")) {
            ps.setString(1, mode);
            ps.setString(2, day);
            ps.setString(3, player);
            ps.setString(4, target);
            ps.setInt(5, moves);
            ps.setInt(6, seconds);
            ps.executeUpdate();
        }
    }

    /** Daily leaderboard: fastest time first; if two times are equal, fewer moves ranks higher. */
    public synchronized List<Score> topDailyScores(String mode, String day, int limit) throws SQLException {
        List<Score> list = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement("""
                SELECT player, target, moves, seconds, created_at FROM daily_scores
                WHERE mode = ? AND day = ?
                ORDER BY seconds ASC, moves ASC, id ASC
                LIMIT ?""")) {
            ps.setString(1, mode);
            ps.setString(2, day);
            ps.setInt(3, limit);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    list.add(new Score(rs.getString("player"), rs.getString("target"),
                            rs.getInt("moves"), rs.getInt("seconds"), rs.getString("created_at")));
                }
            }
        }
        return list;
    }

    @Override
    public void close() throws SQLException {
        conn.close();
    }
}
