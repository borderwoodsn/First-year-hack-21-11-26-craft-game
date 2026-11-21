import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;

/**
 * Song Craft / Film Craft: combine building blocks until you create the target song or film.
 *
 * Run this class, then open http://localhost:8080 in a browser.
 * Optional argument: a port number, e.g. "8081".
 * Must be run from the project folder (it needs data/ and web/).
 */
public class Main {
    public static void main(String[] args) throws Exception {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 8080;

        Path dataDir = Path.of("data");
        Path webDir = Path.of("web");
        if (!Files.isDirectory(dataDir) || !Files.isDirectory(webDir)) {
            System.err.println("Can't find the data/ and web/ folders. Run this from the project folder.");
            System.err.println("Current folder: " + Path.of("").toAbsolutePath());
            System.exit(1);
        }

        Database db = new Database("game.db");
        try {
            Seeder.seed(db, dataDir);
        } catch (IllegalStateException e) {
            System.err.println(e.getMessage());
            System.exit(1);
        }
        warnAboutUnreachableSongs(db);

        new WebServer(db, webDir, dataDir).start(port);
        System.out.println("Song Craft / Film Craft is running at http://localhost:" + port + "  (Ctrl+C or the stop button to quit)");
        System.out.println("For multiplayer, other devices on the same Wi-Fi can open this computer's address (shown in the multiplayer lobby).");
    }

    /** Tells you if a target can't actually be made from the starting blocks. */
    private static void warnAboutUnreachableSongs(Database db) throws Exception {
        for (Database.Mode mode : db.modes()) {
            System.out.println(mode.emoji() + " " + mode.name() + ":");
            Solver solver = new Solver(db.allCombinations(mode.id()));
            Set<String> starters = new HashSet<>();
            for (Database.Element e : db.starters(mode.id())) starters.add(e.name());
            for (Database.Target t : db.targets(mode.id())) {
                int par = solver.par(t.element().name(), starters);
                if (par < 0) {
                    System.err.println("WARNING: \"" + t.element().name() + "\" can't be reached from the starting blocks!");
                } else {
                    System.out.printf("  %-42s reachable in %d combinations%n", t.element().name(), par);
                }
            }
        }
    }
}
