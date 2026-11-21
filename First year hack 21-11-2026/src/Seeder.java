import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.util.*;

/**
 * Each folder inside data/ is one game mode (data/music, data/film, ...). Each one holds:
 *   mode.txt          Name | emoji | what a target is called | menu position
 *   elements.txt      the elements
 *   combinations.txt  the recipes
 *   targets.txt       the goals
 * This class reads them all, checks for mistakes, and loads them into the database. It runs every
 * time the server starts, so editing the text files and restarting is all you need to do.
 * To add a whole new mode, copy a folder, rename it and change the files.
 */
public final class Seeder {
    private Seeder() {}

    public static void seed(Database db, Path dataDir) throws IOException, SQLException {
        List<String> errors = new ArrayList<>();
        List<Database.ModeData> modes = new ArrayList<>();
        List<Integer> positions = new ArrayList<>();

        List<Path> folders;
        try (var stream = Files.list(dataDir)) {
            folders = stream.filter(p -> Files.isRegularFile(p.resolve("mode.txt"))).sorted().toList();
        }
        if (folders.isEmpty()) errors.add("No game modes found: expected folders like data/music containing mode.txt");

        for (Path folder : folders) {
            // ---- mode.txt
            List<Line> modeLines = readLines(folder.resolve("mode.txt"));
            String[] parts = modeLines.isEmpty() ? new String[0] : modeLines.get(0).text.split("\\|");
            if (parts.length < 3) {
                errors.add(folder.getFileName() + "/mode.txt: expected 'Name | emoji | target noun | position'");
                continue;
            }
            int position = 99;
            if (parts.length > 3) {
                try { position = Integer.parseInt(parts[3].trim()); } catch (NumberFormatException ignored) { }
            }
            String id = folder.getFileName().toString().toLowerCase();
            Database.Mode mode = new Database.Mode(id, parts[0].trim(), parts[1].trim(), parts[2].trim());
            Database.ModeData data = loadMode(folder, mode, errors);
            if (data == null) continue;
            // keep the list sorted by the position in mode.txt
            int i = 0;
            while (i < positions.size() && positions.get(i) <= position) i++;
            positions.add(i, position);
            modes.add(i, data);
        }

        if (!errors.isEmpty()) {
            throw new IllegalStateException("Problems in the data files:\n  - " + String.join("\n  - ", errors));
        }

        db.replaceGameData(modes);
        for (Database.ModeData m : modes) {
            System.out.printf("%s %s mode: %d elements, %d combinations, %d targets%n", m.mode().emoji(),
                    m.mode().name(), m.elements().size(), m.combinations().size(), m.targets().size());
        }
    }

    /** Reads one mode's folder. Adds any problems to {@code errors}; returns null if the folder is broken. */
    private static Database.ModeData loadMode(Path dataDir, Database.Mode mode, List<String> errors) throws IOException {
        int errorsBefore = errors.size();
        for (String file : List.of("elements.txt", "combinations.txt", "targets.txt")) {
            if (!Files.isRegularFile(dataDir.resolve(file))) {
                errors.add(dataDir.getFileName() + "/" + file + " is missing");
            }
        }
        if (errors.size() > errorsBefore) return null;

        // ---- elements.txt
        Map<String, Database.ElementDef> elements = new LinkedHashMap<>(); // key = lower-case name
        for (Line line : readLines(dataDir.resolve("elements.txt"))) {
            String[] parts = line.text.split("\\|");
            if (parts.length < 2) {
                errors.add(line.where() + "expected 'Name | emoji' but got: " + line.text);
                continue;
            }
            String name = parts[0].trim();
            String emoji = parts[1].trim();
            boolean starter = parts.length > 2 && parts[2].trim().equalsIgnoreCase("starter");
            if (elements.containsKey(name.toLowerCase())) {
                errors.add(line.where() + "'" + name + "' is listed twice");
                continue;
            }
            elements.put(name.toLowerCase(), new Database.ElementDef(name, emoji, starter));
        }

        // ---- targets.txt (targets are added as elements automatically)
        List<Database.TargetDef> targets = new ArrayList<>();
        for (Line line : readLines(dataDir.resolve("targets.txt"))) {
            String[] parts = line.text.split("\\|");
            if (parts.length < 5) {
                errors.add(line.where() + "expected 'Title | emoji | Creator | Year | Fact' but got: " + line.text);
                continue;
            }
            String name = parts[0].trim();
            int year;
            try {
                year = Integer.parseInt(parts[3].trim());
            } catch (NumberFormatException e) {
                errors.add(line.where() + "year '" + parts[3].trim() + "' is not a number");
                continue;
            }
            // The fact may itself contain '|' characters, so join the rest back together.
            String fact = String.join("|", Arrays.copyOfRange(parts, 4, parts.length)).trim();
            if (elements.containsKey(name.toLowerCase())) {
                errors.add(line.where() + "'" + name + "' is already in elements.txt; remove it from there");
                continue;
            }
            elements.put(name.toLowerCase(), new Database.ElementDef(name, parts[1].trim(), false));
            targets.add(new Database.TargetDef(name, parts[2].trim(), year, fact));
        }

        // ---- combinations.txt
        Map<String, Database.Combination> combos = new LinkedHashMap<>(); // key = "a+b" sorted, lower-case
        Map<String, String> comboLine = new HashMap<>();
        for (Line line : readLines(dataDir.resolve("combinations.txt"))) {
            String[] sides = line.text.split("=");
            String[] inputs = sides[0].split("\\+");
            if (sides.length != 2 || inputs.length != 2) {
                errors.add(line.where() + "expected 'First + Second = Result' but got: " + line.text);
                continue;
            }
            String[] names = {inputs[0].trim(), inputs[1].trim(), sides[1].trim()};
            boolean ok = true;
            for (String n : names) {
                if (!elements.containsKey(n.toLowerCase())) {
                    errors.add(line.where() + "'" + n + "' isn't in elements.txt or targets.txt");
                    ok = false;
                }
            }
            if (!ok) continue;
            // Use the official spelling from elements.txt
            String a = elements.get(names[0].toLowerCase()).name();
            String b = elements.get(names[1].toLowerCase()).name();
            String r = elements.get(names[2].toLowerCase()).name();
            String key = a.compareToIgnoreCase(b) <= 0 ? (a + "+" + b).toLowerCase() : (b + "+" + a).toLowerCase();
            Database.Combination existing = combos.get(key);
            if (existing != null) {
                errors.add(line.where() + a + " + " + b + " is already defined at " + comboLine.get(key)
                        + "(makes " + existing.result() + ")");
                continue;
            }
            combos.put(key, new Database.Combination(a, b, r));
            comboLine.put(key, line.where());
        }

        if (elements.values().stream().noneMatch(Database.ElementDef::starter)) {
            errors.add(dataDir.getFileName() + "/elements.txt: no starting blocks. Mark some with '| starter'");
        }

        if (errors.size() > errorsBefore) return null;
        return new Database.ModeData(mode, elements.values(), combos.values(), targets);
    }

    private record Line(String file, int number, String text) {
        String where() { return file + " line " + number + ": "; }
    }

    private static List<Line> readLines(Path file) throws IOException {
        List<Line> lines = new ArrayList<>();
        List<String> raw = Files.readAllLines(file, StandardCharsets.UTF_8);
        for (int i = 0; i < raw.size(); i++) {
            String text = raw.get(i).strip();
            if (i == 0 && !text.isEmpty() && text.charAt(0) == 0xFEFF) text = text.substring(1).strip(); // byte-order mark
            if (text.isEmpty() || text.startsWith("#")) continue;
            lines.add(new Line(file.getParent().getFileName() + "/" + file.getFileName(), i + 1, text));
        }
        return lines;
    }
}
