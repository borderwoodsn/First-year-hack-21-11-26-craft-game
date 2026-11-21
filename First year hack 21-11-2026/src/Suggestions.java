import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.sql.SQLException;
import java.util.Optional;

/**
 * Player-suggested combinations.
 *
 * When two things don't combine, players can suggest what they should make. The host reviews the
 * suggestions on /admin.html. Approving one adds it to the live database straight away and also
 * writes it to data/&lt;mode&gt;/combinations.txt (and elements.txt for brand-new results), so it is
 * still there after a restart.
 */
public class Suggestions {
    private static final String FILE_HEADER = "# ---------- Added in-game from player suggestions ----------";

    private final Database db;
    private final Path dataDir;

    public Suggestions(Database db, Path dataDir) {
        this.db = db;
        this.dataDir = dataDir;
    }

    /** A name for a new element: no characters that would break the data file format. */
    public static String cleanName(String raw) {
        String name = raw == null ? "" : raw.trim().replaceAll("\\s+", " ");
        if (name.isEmpty()) throw new IllegalArgumentException("Please type what they should make");
        if (name.length() > 40) throw new IllegalArgumentException("That name is too long (40 characters max)");
        if (name.matches(".*[|+=#\\p{Cntrl}].*")) {
            throw new IllegalArgumentException("Names can't contain | + = or #");
        }
        return name;
    }

    public static String cleanEmoji(String raw) {
        String emoji = raw == null ? "" : raw.trim();
        if (emoji.isEmpty()) return "✨";
        if (emoji.length() > 16 || emoji.matches(".*[|\\p{Cntrl}].*")) throw new IllegalArgumentException("Please use a single emoji");
        return emoji;
    }

    /** A player suggests that a + b should make result. */
    public synchronized void suggest(String mode, String a, String b, String result, String emoji, String player)
            throws SQLException {
        Database.Element ea = db.findElement(mode, a).orElseThrow(() -> new IllegalArgumentException("Unknown element: " + a));
        Database.Element eb = db.findElement(mode, b).orElseThrow(() -> new IllegalArgumentException("Unknown element: " + b));
        Optional<Database.Element> existing = db.combine(mode, ea.name(), eb.name());
        if (existing.isPresent()) {
            throw new IllegalArgumentException(ea.name() + " + " + eb.name() + " already makes " + existing.get().name());
        }
        String name = cleanName(result);
        // If it's an existing element, use its emoji and official spelling
        Optional<Database.Element> known = db.findElement(mode, name);
        String finalName = known.map(Database.Element::name).orElse(name);
        String finalEmoji = known.map(Database.Element::emoji).orElse(cleanEmoji(emoji));
        String who = player == null ? null : player.trim();
        if (who != null && who.length() > 20) who = who.substring(0, 20);
        db.addSuggestion(mode, ea.name(), eb.name(), finalName, finalEmoji, who == null || who.isEmpty() ? null : who);
    }

    /** Host approves a suggestion (optionally changing its result or emoji first). */
    public synchronized String approve(int id, String resultOverride, String emojiOverride) throws Exception {
        Database.Suggestion s = db.suggestion(id).orElseThrow(() -> new IllegalArgumentException("No suggestion " + id));
        if (!s.status().equals("pending")) throw new IllegalArgumentException("That suggestion was already " + s.status());
        String result = resultOverride == null || resultOverride.isBlank() ? s.result() : cleanName(resultOverride);
        String emoji = emojiOverride == null || emojiOverride.isBlank() ? s.emoji() : cleanEmoji(emojiOverride);
        String made = add(s.mode(), s.first(), s.second(), result, emoji);
        db.setSuggestionStatus(id, "approved");
        db.closeSuggestionsForPair(s.mode(), s.first(), s.second());
        return made;
    }

    public synchronized void reject(int id) throws SQLException {
        Database.Suggestion s = db.suggestion(id).orElseThrow(() -> new IllegalArgumentException("No suggestion " + id));
        if (!s.status().equals("pending")) throw new IllegalArgumentException("That suggestion was already " + s.status());
        db.setSuggestionStatus(id, "rejected");
    }

    /**
     * Adds a + b = result to the live game and the data files. Creates the result element if it's new.
     * Returns a short description such as "Toy + Story = Toy Story".
     */
    public synchronized String add(String mode, String a, String b, String result, String emoji) throws Exception {
        Database.Element ea = db.findElement(mode, a).orElseThrow(() -> new IllegalArgumentException("Unknown element: " + a));
        Database.Element eb = db.findElement(mode, b).orElseThrow(() -> new IllegalArgumentException("Unknown element: " + b));
        Optional<Database.Element> existing = db.combine(mode, ea.name(), eb.name());
        if (existing.isPresent()) {
            throw new IllegalArgumentException(ea.name() + " + " + eb.name() + " already makes " + existing.get().name());
        }
        String name = cleanName(result);
        Optional<Database.Element> known = db.findElement(mode, name);
        String resultName;
        if (known.isPresent()) {
            resultName = known.get().name();
        } else {
            resultName = name;
            String e = cleanEmoji(emoji);
            db.addElement(mode, resultName, e);
            appendLine(mode, "elements.txt", resultName + " | " + e);
        }
        db.addCombination(mode, ea.name(), eb.name(), resultName);
        String line = ea.name() + " + " + eb.name() + " = " + resultName;
        appendLine(mode, "combinations.txt", line);
        System.out.println("Added from a suggestion (" + mode + "): " + line);
        return line;
    }

    private void appendLine(String mode, String file, String line) throws IOException {
        Path path = dataDir.resolve(mode).resolve(file);
        String content = Files.readString(path, StandardCharsets.UTF_8);
        StringBuilder add = new StringBuilder();
        if (!content.isEmpty() && !content.endsWith("\n")) add.append('\n');
        if (!content.contains(FILE_HEADER)) add.append('\n').append(FILE_HEADER).append('\n');
        add.append(line).append('\n');
        Files.writeString(path, add.toString(), StandardCharsets.UTF_8, StandardOpenOption.APPEND);
    }
}
