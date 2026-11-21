import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.concurrent.Executors;

/**
 * HTTP server: serves the front end from the web/ folder and a JSON API under /api/.
 * Every game request says which mode it's for ("music", "film", ...): ?mode= on GETs,
 * "mode" in the JSON body on POSTs. If it's left out, the first mode is used.
 *
 *   GET  /api/modes                          the game modes
 *   GET  /api/starters?mode=film             the starting blocks
 *   GET  /api/targets?mode=film              targets you can aim for (with par = fewest combinations)
 *   POST /api/combine  {mode, a, b}          what a + b makes  -> {result: {name, emoji} | null}
 *   POST /api/hint     {mode, target, inventory: [names]}  -> {hint: {first, second} | null}
 *   GET  /api/scores?mode=film&target=Jaws   leaderboard for a target
 *   POST /api/scores   {mode, player, target, moves, seconds}
 *   GET  /api/stats?mode=film                total number of elements in that mode
 *
 *   Multiplayer (see Multiplayer.java):
 *   GET  /api/mp/info                        addresses other devices can use to reach this server
 *   POST /api/mp/create {mode, name}         -> {code, player}
 *   POST /api/mp/join   {code, name}         -> {code, player, mode}
 *   POST /api/mp/leave  {code, player}
 *   POST /api/mp/start  {code, player, target: "random" | name}   (host only)
 *   POST /api/mp/combine {code, player, a, b} -> {result, finished}
 *   GET  /api/mp/state?code=ABCD&player=...  lobby + race state (poll about once a second)
 *
 *   Recipe book, suggestions and rush mode:
 *   GET  /api/element?mode=film&name=Shark   spoiler-free info: how many recipes make / use it
 *   POST /api/suggest {mode, a, b, result, emoji, player}   suggest what a failed pair should make
 *   GET  /api/rush/scores?mode=film          rush leaderboard;  POST {mode, player, score}
 *
 *   Admin (only from the computer running the server, see /admin.html):
 *   GET  /api/admin/suggestions?status=pending
 *   POST /api/admin/approve {id, result?, emoji?}   POST /api/admin/reject {id}
 *   POST /api/admin/add {mode, a, b, result, emoji} add a combination directly
 *
 *   GET  /api/daily?mode=film                today's daily challenge: {day, target, par, moveLimit}
 *   GET  /api/daily/scores?mode=film         today's daily leaderboard (fastest first, then fewest moves)
 *   POST /api/daily/scores {mode, day, player, moves, seconds}
 */
public class WebServer {
    private static final int MAX_BODY_BYTES = 64 * 1024;

    private final Database db;
    private final Multiplayer multiplayer;
    private final Suggestions suggestions;
    private int port;
    private final Path webRoot;

    public WebServer(Database db, Path webRoot, Path dataDir) {
        this.db = db;
        this.webRoot = webRoot.toAbsolutePath().normalize();
        this.multiplayer = new Multiplayer(db);
        this.suggestions = new Suggestions(db, dataDir);
    }

    public void start(int port) throws IOException {
        this.port = port;
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/api/", this::handleApi);
        server.createContext("/", this::handleStatic);
        // Several devices poll at once in multiplayer, so handle requests in parallel.
        // Database and Multiplayer methods are synchronized, so this is safe.
        server.setExecutor(Executors.newFixedThreadPool(16));
        server.start();
    }

    // ------------------------------------------------------------------ API

    private void handleApi(HttpExchange ex) throws IOException {
        String route = ex.getRequestMethod() + " " + ex.getRequestURI().getPath();
        try {
            Map<String, String> q = query(ex);
            Object response = switch (route) {
                case "GET /api/modes" -> modes();
                case "GET /api/starters" -> starters(mode(q.get("mode")));
                case "GET /api/targets" -> targets(mode(q.get("mode")));
                case "GET /api/scores" -> scores(mode(q.get("mode")), q.getOrDefault("target", ""));
                case "GET /api/stats" -> Map.of("totalElements", db.countElements(mode(q.get("mode"))));
                case "POST /api/combine" -> { var body = readBody(ex); yield combine(mode(body.get("mode")), body); }
                case "POST /api/hint" -> { var body = readBody(ex); yield hint(mode(body.get("mode")), body); }
                case "POST /api/scores" -> { var body = readBody(ex); yield addScore(mode(body.get("mode")), body); }
                case "GET /api/daily" -> daily(mode(q.get("mode")));
                case "GET /api/daily/scores" -> dailyScores(mode(q.get("mode")), day(q.get("day")));
                case "POST /api/daily/scores" -> { var body = readBody(ex); yield addDailyScore(mode(body.get("mode")), body); }
                case "GET /api/mp/info" -> Map.of("addresses", lanAddresses());
                case "POST /api/mp/create" -> {
                    var body = readBody(ex);
                    yield multiplayer.create(mode(body.get("mode")), requireString(body, "name", 40));
                }
                case "POST /api/mp/join" -> {
                    var body = readBody(ex);
                    yield multiplayer.join(requireString(body, "code", 10), requireString(body, "name", 40));
                }
                case "POST /api/mp/leave" -> {
                    var body = readBody(ex);
                    multiplayer.leave(requireString(body, "code", 10), requireString(body, "player", 64));
                    yield Map.of("ok", true);
                }
                case "POST /api/mp/start" -> {
                    var body = readBody(ex);
                    multiplayer.start(requireString(body, "code", 10), requireString(body, "player", 64),
                            body.get("target") instanceof String t ? t : "random");
                    yield Map.of("ok", true);
                }
                case "POST /api/mp/combine" -> {
                    var body = readBody(ex);
                    yield multiplayer.combine(requireString(body, "code", 10), requireString(body, "player", 64),
                            requireString(body, "a", 100), requireString(body, "b", 100));
                }
                case "GET /api/mp/state" -> multiplayer.state(q.getOrDefault("code", ""), q.getOrDefault("player", ""));
                case "GET /api/element" -> elementInfo(mode(q.get("mode")), q.getOrDefault("name", ""));
                case "POST /api/suggest" -> {
                    var body = readBody(ex);
                    suggestions.suggest(mode(body.get("mode")), requireString(body, "a", 100), requireString(body, "b", 100),
                            requireString(body, "result", 100), body.get("emoji") instanceof String e ? e : "",
                            body.get("player") instanceof String p ? p : null);
                    yield Map.of("ok", true);
                }
                case "GET /api/rush/scores" -> Map.of("scores", db.topRushScores(mode(q.get("mode")), 10));
                case "POST /api/rush/scores" -> { var body = readBody(ex); yield addRushScore(mode(body.get("mode")), body); }
                case "GET /api/admin/suggestions" -> {
                    requireAdmin(ex);
                    List<Object> list = new ArrayList<>();
                    for (Database.Suggestion sg : db.suggestions(q.getOrDefault("status", "pending"))) list.add(sg.toJson());
                    yield Map.of("suggestions", list);
                }
                case "POST /api/admin/approve" -> {
                    requireAdmin(ex);
                    var body = readBody(ex);
                    yield Map.of("added", suggestions.approve(requireInt(body, "id"),
                            body.get("result") instanceof String r ? r : null, body.get("emoji") instanceof String e ? e : null));
                }
                case "POST /api/admin/reject" -> {
                    requireAdmin(ex);
                    suggestions.reject(requireInt(readBody(ex), "id"));
                    yield Map.of("ok", true);
                }
                case "POST /api/admin/add" -> {
                    requireAdmin(ex);
                    var body = readBody(ex);
                    yield Map.of("added", suggestions.add(mode(body.get("mode")), requireString(body, "a", 100),
                            requireString(body, "b", 100), requireString(body, "result", 100),
                            body.get("emoji") instanceof String e ? e : ""));
                }
                default -> null;
            };
            if (response == null) sendJson(ex, 404, Map.of("error", "Not found: " + route));
            else sendJson(ex, 200, response);
        } catch (SecurityException e) {
            sendJson(ex, 403, Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            sendJson(ex, 400, Map.of("error", e.getMessage()));
        } catch (Exception e) {
            e.printStackTrace();
            sendJson(ex, 500, Map.of("error", "Server error"));
        }
    }

    /** Checks the requested mode exists. Defaults to the first mode if none was given. */
    private String mode(Object requested) throws Exception {
        if (requested == null) {
            List<Database.Mode> modes = db.modes();
            if (modes.isEmpty()) throw new IllegalArgumentException("No game modes are loaded");
            return modes.get(0).id();
        }
        if (!(requested instanceof String s) || !db.modeExists(s)) {
            throw new IllegalArgumentException("Unknown mode: " + requested);
        }
        return s;
    }

    private Object modes() throws Exception {
        List<Object> list = new ArrayList<>();
        for (Database.Mode m : db.modes()) list.add(m.toJson());
        return Map.of("modes", list);
    }

    private Object starters(String mode) throws Exception {
        List<Object> list = new ArrayList<>();
        for (Database.Element e : db.starters(mode)) list.add(e.toJson());
        return Map.of("elements", list);
    }

    private Object targets(String mode) throws Exception {
        Solver solver = new Solver(db.allCombinations(mode));
        Set<String> starters = starterNames(mode);
        List<Object> list = new ArrayList<>();
        for (Database.Target t : db.targets(mode)) {
            Map<String, Object> m = t.element().toJson();
            m.put("creator", t.creator());
            m.put("year", t.year());
            m.put("fact", t.fact());
            m.put("par", solver.par(t.element().name(), starters));
            list.add(m);
        }
        return Map.of("targets", list);
    }

    private Object combine(String mode, Map<String, Object> body) throws Exception {
        String a = requireString(body, "a", 100);
        String b = requireString(body, "b", 100);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("result", db.combine(mode, a, b).map(Database.Element::toJson).orElse(null));
        return m;
    }

    private Object hint(String mode, Map<String, Object> body) throws Exception {
        String target = requireString(body, "target", 100);
        if (!(body.get("inventory") instanceof List<?> inventory) || inventory.size() > 5000) {
            throw new IllegalArgumentException("'inventory' must be a list of element names");
        }
        List<Database.Combination> combos = db.allCombinations(mode);
        // Map whatever spelling the client sent to the official names.
        Map<String, String> canonical = new HashMap<>();
        for (Database.Combination c : combos) {
            canonical.put(c.first().toLowerCase(), c.first());
            canonical.put(c.second().toLowerCase(), c.second());
            canonical.put(c.result().toLowerCase(), c.result());
        }
        Set<String> known = new HashSet<>();
        for (Object o : inventory) {
            if (o instanceof String s && canonical.containsKey(s.toLowerCase())) known.add(canonical.get(s.toLowerCase()));
        }
        String targetName = canonical.getOrDefault(target.toLowerCase(), target);

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("hint", new Solver(combos).hint(targetName, known).map(c -> {
            Map<String, Object> h = new LinkedHashMap<>();
            h.put("first", c.first());
            h.put("second", c.second());
            return h;
        }).orElse(null));
        return m;
    }

    private Object scores(String mode, String target) throws Exception {
        List<Object> list = new ArrayList<>();
        for (Database.Score s : db.topScores(mode, target, 10)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("player", s.player());
            m.put("moves", s.moves());
            m.put("seconds", s.seconds());
            m.put("date", s.createdAt());
            list.add(m);
        }
        return Map.of("scores", list);
    }

    private Object addScore(String mode, Map<String, Object> body) throws Exception {
        String player = requireString(body, "player", 20).trim();
        String target = requireString(body, "target", 100);
        int moves = requireInt(body, "moves");
        int seconds = requireInt(body, "seconds");
        if (player.isEmpty()) throw new IllegalArgumentException("Please enter a name");
        boolean isTarget = db.targets(mode).stream().anyMatch(t -> t.element().name().equalsIgnoreCase(target));
        if (!isTarget) throw new IllegalArgumentException("Unknown target: " + target);
        db.addScore(mode, player, target, moves, seconds);
        return scores(mode, target);
    }

    /** Admin actions are only allowed from the computer that is running the server. */
    private static void requireAdmin(HttpExchange ex) {
        if (!ex.getRemoteAddress().getAddress().isLoopbackAddress()) {
            throw new SecurityException("Admin pages only work on the computer running the server");
        }
    }

    /** Spoiler-free facts about an element for the recipe book. */
    private Object elementInfo(String mode, String name) throws Exception {
        Database.Element e = db.findElement(mode, name).orElseThrow(() -> new IllegalArgumentException("Unknown element: " + name));
        int making = 0, using = 0;
        for (Database.Combination c : db.allCombinations(mode)) {
            if (c.result().equalsIgnoreCase(e.name())) making++;
            if (c.first().equalsIgnoreCase(e.name()) || c.second().equalsIgnoreCase(e.name())) using++;
        }
        boolean isTarget = db.targets(mode).stream().anyMatch(t -> t.element().name().equalsIgnoreCase(e.name()));
        Map<String, Object> m = e.toJson();
        m.put("starter", e.starter());
        m.put("target", isTarget);
        m.put("recipesMaking", making);
        m.put("recipesUsing", using);
        return m;
    }

    private Object addRushScore(String mode, Map<String, Object> body) throws Exception {
        String player = requireString(body, "player", 20).trim();
        if (player.isEmpty()) throw new IllegalArgumentException("Please enter a name");
        int score = requireInt(body, "score");
        if (score > db.targets(mode).size()) throw new IllegalArgumentException("That score isn't possible");
        db.addRushScore(mode, player, score);
        return Map.of("scores", db.topRushScores(mode, 10));
    }

    /** The addresses other devices on the same network can use to open the game. */
    private List<String> lanAddresses() {
        List<String> list = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) continue;
                for (InetAddress addr : Collections.list(ni.getInetAddresses())) {
                    if (addr instanceof Inet4Address && addr.isSiteLocalAddress()) {
                        list.add("http://" + addr.getHostAddress() + ":" + port);
                    }
                }
            }
        } catch (Exception ignored) {
            // no network information available
        }
        return list;
    }

    // ------------------------------------------------------------------ daily challenge

    /** The daily challenge for one mode on one day. */
    private record Daily(LocalDate day, Database.Target target, int par, int moveLimit) {}

    /**
     * Picks the day's target. Everyone gets the same one because the choice depends only on the
     * date and the mode. The move limit is par plus some spare moves (at least 3).
     */
    private Daily dailyFor(String mode, LocalDate day) throws Exception {
        List<Database.Target> targets = db.targets(mode);
        if (targets.isEmpty()) throw new IllegalArgumentException("This mode has no targets");
        long seed = day.toEpochDay() * 1_000_003L + mode.hashCode();
        Database.Target target = targets.get(new Random(seed).nextInt(targets.size()));
        int par = new Solver(db.allCombinations(mode)).par(target.element().name(), starterNames(mode));
        int moveLimit = par + Math.max(3, (par + 1) / 2);
        return new Daily(day, target, par, moveLimit);
    }

    private Object daily(String mode) throws Exception {
        Daily d = dailyFor(mode, LocalDate.now());
        Map<String, Object> target = d.target().element().toJson();
        target.put("creator", d.target().creator());
        target.put("year", d.target().year());
        target.put("fact", d.target().fact());
        target.put("par", d.par());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("day", d.day().toString());
        m.put("target", target);
        m.put("par", d.par());
        m.put("moveLimit", d.moveLimit());
        return m;
    }

    /**
     * The day a request is about. Defaults to today. Yesterday is also accepted, so a game started
     * just before midnight can still be submitted.
     */
    private static LocalDate day(Object requested) {
        LocalDate today = LocalDate.now();
        if (requested == null) return today;
        LocalDate day;
        try {
            day = LocalDate.parse(String.valueOf(requested));
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("'day' must look like 2026-11-21");
        }
        if (!day.equals(today) && !day.equals(today.minusDays(1))) {
            throw new IllegalArgumentException("That daily challenge has finished");
        }
        return day;
    }

    private Object dailyScores(String mode, LocalDate day) throws Exception {
        List<Object> list = new ArrayList<>();
        for (Database.Score s : db.topDailyScores(mode, day.toString(), 10)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("player", s.player());
            m.put("moves", s.moves());
            m.put("seconds", s.seconds());
            list.add(m);
        }
        return Map.of("scores", list);
    }

    private Object addDailyScore(String mode, Map<String, Object> body) throws Exception {
        String player = requireString(body, "player", 20).trim();
        int moves = requireInt(body, "moves");
        int seconds = requireInt(body, "seconds");
        if (player.isEmpty()) throw new IllegalArgumentException("Please enter a name");
        Daily d = dailyFor(mode, day(body.get("day")));
        if (moves > d.moveLimit()) {
            throw new IllegalArgumentException("That's more than the " + d.moveLimit() + "-move limit");
        }
        db.addDailyScore(mode, d.day().toString(), player, d.target().element().name(), moves, seconds);
        return dailyScores(mode, d.day());
    }

    private Set<String> starterNames(String mode) throws Exception {
        Set<String> names = new HashSet<>();
        for (Database.Element e : db.starters(mode)) names.add(e.name());
        return names;
    }

    // ------------------------------------------------------------------ request helpers

    private static Map<String, Object> readBody(HttpExchange ex) throws IOException {
        byte[] bytes;
        try (InputStream in = ex.getRequestBody()) {
            bytes = in.readNBytes(MAX_BODY_BYTES + 1);
        }
        if (bytes.length > MAX_BODY_BYTES) throw new IllegalArgumentException("Request body too large");
        Object parsed = Json.parse(new String(bytes, StandardCharsets.UTF_8));
        if (!(parsed instanceof Map<?, ?> map)) throw new IllegalArgumentException("Expected a JSON object");
        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) map;
        return result;
    }

    private static String requireString(Map<String, Object> body, String key, int maxLength) {
        if (!(body.get(key) instanceof String s) || s.isBlank()) {
            throw new IllegalArgumentException("'" + key + "' is required");
        }
        if (s.length() > maxLength) throw new IllegalArgumentException("'" + key + "' is too long");
        return s;
    }

    private static int requireInt(Map<String, Object> body, String key) {
        if (!(body.get(key) instanceof Number n) || n.longValue() < 0 || n.longValue() > 1_000_000) {
            throw new IllegalArgumentException("'" + key + "' must be a non-negative number");
        }
        return n.intValue();
    }

    private static Map<String, String> query(HttpExchange ex) {
        Map<String, String> params = new HashMap<>();
        String raw = ex.getRequestURI().getRawQuery();
        if (raw == null) return params;
        for (String pair : raw.split("&")) {
            int eq = pair.indexOf('=');
            if (eq < 0) continue;
            params.put(URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8),
                       URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
        }
        return params;
    }

    private static void sendJson(HttpExchange ex, int status, Object body) throws IOException {
        send(ex, status, "application/json; charset=utf-8", Json.write(body).getBytes(StandardCharsets.UTF_8));
    }

    private static void send(HttpExchange ex, int status, String contentType, byte[] bytes) throws IOException {
        ex.getResponseHeaders().set("Content-Type", contentType);
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = ex.getResponseBody()) {
            out.write(bytes);
        }
    }

    // ------------------------------------------------------------------ static files

    private void handleStatic(HttpExchange ex) throws IOException {
        if (!ex.getRequestMethod().equals("GET") && !ex.getRequestMethod().equals("HEAD")) {
            send(ex, 405, "text/plain", "Method not allowed".getBytes(StandardCharsets.UTF_8));
            return;
        }
        String path = ex.getRequestURI().getPath();
        if (path.equals("/")) path = "/index.html";
        Path file = webRoot.resolve(path.substring(1)).normalize();
        if (!file.startsWith(webRoot) || !Files.isRegularFile(file)) {
            send(ex, 404, "text/plain", "Not found".getBytes(StandardCharsets.UTF_8));
            return;
        }
        send(ex, 200, contentType(file), Files.readAllBytes(file));
    }

    private static String contentType(Path file) {
        String name = file.getFileName().toString().toLowerCase();
        if (name.endsWith(".html")) return "text/html; charset=utf-8";
        if (name.endsWith(".css")) return "text/css; charset=utf-8";
        if (name.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }
}
