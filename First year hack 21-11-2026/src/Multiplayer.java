import java.security.SecureRandom;
import java.util.*;

/**
 * Multiplayer races. A host creates a lobby and gets a 4-letter code; other players join with the
 * code from their own devices. When the host starts a race, everyone gets the same target and the
 * same starting blocks, and the first player to craft the target wins.
 *
 * The server keeps track of what every player has made, so a player can only combine things they
 * really own, and the server (not the browser) decides who won. Everything is kept in memory:
 * lobbies disappear when the server restarts.
 */
public class Multiplayer {
    private static final int MAX_PLAYERS = 8;
    private static final long COUNTDOWN_MS = 3_500;
    private static final long PLAYER_TIMEOUT_MS = 90_000;      // removed if they stop checking in
    private static final long LOBBY_TIMEOUT_MS = 2 * 60 * 60_000; // lobbies expire after 2 idle hours
    private static final String CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O (look like 1 and 0)

    private final Database db;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Lobby> lobbies = new HashMap<>();

    private static final class Player {
        final String id;
        final String name;
        final Set<String> inventory = new HashSet<>(); // lower-case names
        int discoveries;
        long lastSeen = System.currentTimeMillis();

        Player(String id, String name) {
            this.id = id;
            this.name = name;
        }
    }

    private static final class Lobby {
        final String code;
        final String mode;
        final LinkedHashMap<String, Player> players = new LinkedHashMap<>();
        String hostId;
        String status = "waiting"; // waiting -> racing -> finished -> (racing again)
        int round;
        Database.Target target;
        String targetChoice = "random";
        long startAt;
        String winnerId;
        long winnerMs;
        long lastActivity = System.currentTimeMillis();
        String endReason;   // how the last race ended: "win" or "quit"
        String quitterName; // who quit, if endReason is "quit"

        Lobby(String code, String mode) {
            this.code = code;
            this.mode = mode;
        }
    }

    public Multiplayer(Database db) {
        this.db = db;
    }

    // ------------------------------------------------------------------ actions

    public synchronized Map<String, Object> create(String mode, String name) {
        cleanUp();
        String code;
        do {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 4; i++) sb.append(CODE_LETTERS.charAt(random.nextInt(CODE_LETTERS.length())));
            code = sb.toString();
        } while (lobbies.containsKey(code));
        Lobby lobby = new Lobby(code, mode);
        lobbies.put(code, lobby);
        Player host = addPlayer(lobby, name);
        lobby.hostId = host.id;
        return Map.of("code", code, "player", host.id);
    }

    public synchronized Map<String, Object> join(String code, String name) {
        cleanUp();
        Lobby lobby = lobby(code);
        if (lobby.status.equals("racing")) {
            throw new IllegalArgumentException("That race has already started. Try again when it finishes.");
        }
        if (lobby.players.size() >= MAX_PLAYERS) throw new IllegalArgumentException("That lobby is full");
        Player p = addPlayer(lobby, name);
        return Map.of("code", lobby.code, "player", p.id, "mode", lobby.mode);
    }

    public synchronized void leave(String code, String playerId) {
        Lobby lobby = lobbies.get(normalise(code));
        if (lobby == null) return;
        removePlayer(lobby, playerId);
    }

    /** Host only: starts a race (or the next one) with a random or chosen target. */
    public synchronized void start(String code, String playerId, String targetChoice) throws Exception {
        Lobby lobby = lobby(code);
        Player p = player(lobby, playerId);
        if (!p.id.equals(lobby.hostId)) throw new IllegalArgumentException("Only the host can start the race");
        if (lobby.status.equals("racing")) throw new IllegalArgumentException("A race is already running");

        List<Database.Target> targets = db.targets(lobby.mode);
        if (targets.isEmpty()) throw new IllegalArgumentException("This mode has no targets");
        Database.Target chosen = null;
        if (targetChoice != null && !targetChoice.equals("random")) {
            chosen = targets.stream().filter(t -> t.element().name().equalsIgnoreCase(targetChoice)).findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("Unknown target: " + targetChoice));
        } else {
            // Random, but not the same target twice in a row
            List<Database.Target> pool = new ArrayList<>(targets);
            if (lobby.target != null && pool.size() > 1) pool.removeIf(t -> t.element().name().equals(lobby.target.element().name()));
            chosen = pool.get(random.nextInt(pool.size()));
        }

        List<String> starters = new ArrayList<>();
        for (Database.Element e : db.starters(lobby.mode)) starters.add(e.name().toLowerCase());
        for (Player each : lobby.players.values()) {
            each.inventory.clear();
            each.inventory.addAll(starters);
            each.discoveries = 0;
        }
        lobby.target = chosen;
        lobby.targetChoice = targetChoice == null ? "random" : targetChoice;
        lobby.status = "racing";
        lobby.round++;
        lobby.startAt = System.currentTimeMillis() + COUNTDOWN_MS;
        lobby.winnerId = null;
        lobby.winnerMs = 0;
        lobby.endReason = null;
        lobby.quitterName = null;
        lobby.lastActivity = System.currentTimeMillis();
    }

    /** Combines two things the player owns. The first player to make the target wins. */
    public synchronized Map<String, Object> combine(String code, String playerId, String a, String b) throws Exception {
        Lobby lobby = lobby(code);
        Player p = player(lobby, playerId);
        long now = System.currentTimeMillis();
        if (!lobby.status.equals("racing")) throw new IllegalArgumentException("The race isn't running");
        if (now < lobby.startAt) throw new IllegalArgumentException("Wait for GO!");
        if (!p.inventory.contains(a.toLowerCase()) || !p.inventory.contains(b.toLowerCase())) {
            throw new IllegalArgumentException("You haven't discovered both of those yet");
        }

        Optional<Database.Element> result = db.combine(lobby.mode, a, b);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("result", result.map(Database.Element::toJson).orElse(null));
        if (result.isPresent() && p.inventory.add(result.get().name().toLowerCase())) p.discoveries++;
        if (result.isPresent() && result.get().name().equalsIgnoreCase(lobby.target.element().name())) {
            lobby.status = "finished";
            lobby.endReason = "win";
            lobby.winnerId = p.id;
            lobby.winnerMs = now - lobby.startAt;
        }
        lobby.lastActivity = now;
        m.put("finished", lobby.status.equals("finished"));
        return m;
    }

    /** Everything a player's screen needs. Polled about once a second, which also keeps them connected. */
    public synchronized Map<String, Object> state(String code, String playerId) {
        cleanUp();
        Lobby lobby = lobby(code);
        Player me = player(lobby, playerId);
        long now = System.currentTimeMillis();
        me.lastSeen = now;

        List<Object> players = new ArrayList<>();
        for (Player p : lobby.players.values()) {
            Map<String, Object> pm = new LinkedHashMap<>();
            pm.put("id", p.id);
            pm.put("name", p.name);
            pm.put("host", p.id.equals(lobby.hostId));
            pm.put("you", p.id.equals(me.id));
            pm.put("discoveries", p.discoveries);
            pm.put("connected", now - p.lastSeen < 10_000);
            players.add(pm);
        }

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", lobby.code);
        m.put("mode", lobby.mode);
        m.put("status", lobby.status);
        m.put("round", lobby.round);
        m.put("you", me.id);
        m.put("isHost", me.id.equals(lobby.hostId));
        m.put("players", players);
        m.put("targetChoice", lobby.targetChoice);
        if (lobby.endReason != null) m.put("endReason", lobby.endReason);
        if (lobby.quitterName != null) m.put("quitter", lobby.quitterName);
        if (lobby.target != null && !lobby.status.equals("waiting")) {
            Map<String, Object> t = lobby.target.element().toJson();
            t.put("creator", lobby.target.creator());
            t.put("year", lobby.target.year());
            t.put("fact", lobby.target.fact());
            m.put("target", t);
        }
        m.put("startsInMs", lobby.status.equals("racing") ? Math.max(0, lobby.startAt - now) : 0);
        m.put("elapsedMs", lobby.status.equals("racing") ? Math.max(0, now - lobby.startAt) : lobby.winnerMs);
        if (lobby.winnerId != null) {
            Player w = lobby.players.get(lobby.winnerId);
            Map<String, Object> wm = new LinkedHashMap<>();
            wm.put("id", lobby.winnerId);
            wm.put("name", w == null ? "A player who left" : w.name);
            wm.put("ms", lobby.winnerMs);
            m.put("winner", wm);
        }
        return m;
    }

    // ------------------------------------------------------------------ helpers

    private static String normalise(String code) {
        return code == null ? "" : code.trim().toUpperCase();
    }

    private Lobby lobby(String code) {
        Lobby lobby = lobbies.get(normalise(code));
        if (lobby == null) throw new IllegalArgumentException("No lobby with code " + normalise(code));
        return lobby;
    }

    private static Player player(Lobby lobby, String playerId) {
        Player p = lobby.players.get(playerId);
        if (p == null) throw new IllegalArgumentException("You're not in this lobby any more");
        return p;
    }

    private Player addPlayer(Lobby lobby, String requestedName) {
        String base = requestedName.trim();
        if (base.isEmpty()) throw new IllegalArgumentException("Please enter a name");
        if (base.length() > 16) base = base.substring(0, 16);
        // Keep names unique inside a lobby: "Sam", "Sam 2", "Sam 3"...
        String name = base;
        int n = 2;
        while (true) {
            String candidate = name;
            if (lobby.players.values().stream().noneMatch(p -> p.name.equalsIgnoreCase(candidate))) break;
            name = base + " " + n++;
        }
        byte[] bytes = new byte[12];
        random.nextBytes(bytes);
        StringBuilder id = new StringBuilder();
        for (byte x : bytes) id.append(String.format("%02x", x));
        Player p = new Player(id.toString(), name);
        lobby.players.put(p.id, p);
        lobby.lastActivity = System.currentTimeMillis();
        return p;
    }

    /**
     * Removes a player (they quit, closed the tab, or stopped responding). If a race is running, it
     * ends for everyone. When only one player is left, they win because the other player quit.
     */
    private void removePlayer(Lobby lobby, String playerId) {
        Player quitter = lobby.players.remove(playerId);
        if (lobby.players.isEmpty()) {
            lobbies.remove(lobby.code);
            return;
        }
        if (playerId.equals(lobby.hostId)) lobby.hostId = lobby.players.keySet().iterator().next(); // pass host on
        long now = System.currentTimeMillis();
        if (quitter != null && lobby.status.equals("racing")) {
            lobby.status = "finished";
            lobby.endReason = "quit";
            lobby.quitterName = quitter.name;
            if (lobby.players.size() == 1) {
                lobby.winnerId = lobby.players.keySet().iterator().next();
                lobby.winnerMs = Math.max(0, now - lobby.startAt);
            }
        }
        lobby.lastActivity = now;
    }

    private void cleanUp() {
        long now = System.currentTimeMillis();
        for (Lobby lobby : new ArrayList<>(lobbies.values())) {
            for (Player p : new ArrayList<>(lobby.players.values())) {
                if (now - p.lastSeen > PLAYER_TIMEOUT_MS) removePlayer(lobby, p.id);
            }
            if (lobbies.containsKey(lobby.code) && now - lobby.lastActivity > LOBBY_TIMEOUT_MS) lobbies.remove(lobby.code);
        }
    }
}
