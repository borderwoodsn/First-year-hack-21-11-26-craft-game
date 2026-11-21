# 🎵 Song Craft / 🎬 Film Craft

A crafting game in the style of Infinite Craft, with two modes. Pick one using the tabs on the level screen.

- **🎵 Music:** start with Sound, Rhythm, Voice, Person, Emotion, Electricity, Time and Nature, then combine
  until you make the target song. For example, *Pop + Zombie = Thriller*.
- **🎬 Film:** start with Camera, Actor, Story, Light, Emotion, Machine, Water and Time, then combine until you
  make the target film. For example, *Time Machine + Car = Back to the Future*.

## Running it

**IntelliJ:** open `src/Main.java` and press Run, then go to <http://localhost:8080>.
(The SQLite driver in `lib/` is already set up as a module library.)

**Command line:** `run.bat` on Windows or `./run.sh` on Mac/Linux/Git Bash. Add a port number to use a
different port, e.g. `run.bat 8081`.

Requires Java 17 or newer. Run it from the project folder.

## How it's built

```
data/            game content (plain text, easy to edit). One folder per game mode:
  music/  film/
    mode.txt           Name | emoji | what a target is called | menu position
    elements.txt       every element + emoji, starters marked "| starter"
    combinations.txt   "A + B = Result" (order doesn't matter)
    targets.txt        targets: title | emoji | artist/director | year | fun fact
src/             Java back end (no frameworks, only the SQLite JDBC driver)
  Main.java          starts everything
  Database.java      SQLite tables + queries  (game.db is created automatically)
  Seeder.java        loads + checks data/*.txt into the database on every start
  Solver.java        hints, par (fewest combinations), unreachable-song warnings
  WebServer.java     JSON API + serves the web/ folder
  Json.java          tiny JSON reader/writer
web/             front end (plain HTML/CSS/JS)
  index.html         page layout, including the title screen
  style.css          base layout + light/dark colours
  arcade.css         the retro arcade skin: pixel fonts, cassette/ticket level cards, title screen
  pixel.js           8-bit sprites drawn from text grids (edit or add art here) + per-mode art choices
  game.js            all game logic
lib/             sqlite-jdbc driver
```

### Database tables (`game.db`)

| table          | columns                                                          |
|----------------|------------------------------------------------------------------|
| `modes`        | id (folder name), name, emoji, noun, sort_order                  |
| `elements`     | id, mode, name, emoji, is_starter                                |
| `combinations` | first_id, second_id, result_id (stored with first_id ≤ second_id) |
| `targets`      | element_id, creator, year, fact, sort_order                      |
| `scores`       | id, mode, player, target, moves, seconds, created_at             |

Every time the server starts, modes, elements, combinations and targets are reloaded from `data/`. Scores are kept.

### API

Every request says which mode it's for: `?mode=film` on GETs, or `"mode": "film"` in POST bodies.
If it's left out, the first mode is used.

| method | path            | body / query                      | returns                       |
|--------|-----------------|-----------------------------------|-------------------------------|
| GET    | `/api/modes`    |                                   | the game modes                |
| GET    | `/api/starters` |                                   | starting blocks               |
| GET    | `/api/targets`  |                                   | songs + `par`                 |
| POST   | `/api/combine`  | `{"a": "Sound", "b": "Rhythm"}`   | `{"result": {name, emoji}}` or `null` |
| POST   | `/api/hint`     | `{"target": "...", "inventory": [...]}` | next pair to try        |
| GET    | `/api/scores`   | `?target=Thriller`                | top 10                        |
| POST   | `/api/scores`   | `{player, target, moves, seconds}`| updated top 10                |
| GET    | `/api/stats`    |                                   | total element count           |
| GET    | `/api/daily`    |                                   | today's challenge: target, par, moveLimit |
| GET    | `/api/daily/scores` | `?day=2026-11-21` (optional)  | today's top 10 (fastest, then fewest moves) |
| POST   | `/api/daily/scores` | `{day, player, moves, seconds}` | updated top 10              |

### Recipe book, achievements, suggestions and Rush (`web/extras.js`)

- **📖 Recipe book** (📖 button, or right-click any block): your lifetime collection for each mode. It
  shows how you first made each thing, every recipe you know, what it's used in, and spoiler-free hints
  from `/api/element` such as "there are 15 ways to make it, you know 1". Saved in the browser.
- **🏅 Profile + achievements**: 20 badges, such as Under Par, Lightning Fingers, Double Feature,
  On a Roll (3-day daily streak), Champion and Unstoppable. Each one pops up as
  "ACHIEVEMENT UNLOCKED". The profile shows stats for both modes.
- **💡 Player suggestions**: when two things don't combine, a bar offers "Suggest a result". Suggestions
  go into the `suggestions` table, and repeat suggestions add votes. **The host reviews them at
  `http://localhost:8080/admin.html`** (it only works on the server's own computer). Approving one adds it
  to the live game straight away and appends it to `data/<mode>/combinations.txt` (and `elements.txt`
  if it's a new element), so it survives restarts. The admin page can also add combinations directly.
- **⏱️ Rush mode** (card in the song/film picker): 3 minutes to craft as many targets as you can. Your
  discoveries carry over between targets. Each target adds +20s, and hints cost 15s. Scores go to the
  `rush_scores` leaderboard.

### Multiplayer

On the title screen, choose **👥 MULTIPLAYER** and press start. The host creates a lobby and gets a
4-letter code. Friends join with that code from their own devices, and up to 8 players can race. The host
picks a target (or a random one) and starts the race. After a 3-2-1 countdown, the first player to craft
the target wins. The server (`Multiplayer.java`) tracks every player's items and decides the winner, so
the browser can't fake a win. Lobbies live in memory and disappear when the server restarts.

**Playing from other devices:**
- **Same Wi-Fi (easiest):** start the server on one laptop. The lobby screen shows its address, e.g.
  `http://192.168.1.23:8080`. Everyone else types that into their browser. The first time, Windows may
  ask whether Java can use the network. Click *Allow* for private networks. Some university or guest
  Wi-Fi networks block devices from talking to each other. If so, use a phone hotspot instead.
- **Different networks:** run a free tunnel such as `cloudflared tunnel --url http://localhost:8080` or
  `ngrok http 8080`. It prints a public `https://...` link that anyone can open. Or host the server on a
  cloud service.

### Daily challenge

Each mode has one daily target, picked from the date, so everyone gets the same one. The move limit is
par plus some spare moves (at least 3). There are no hints. Running out of moves ends the attempt, and you
can retry with the clock starting from zero. The daily leaderboard (`daily_scores` table) ranks by
**fastest time**. If two times are equal, **fewer moves** ranks higher. The server refuses scores over the
move limit, and scores for any day other than today or yesterday.

## Adding content

1. Add any new elements to `data/<mode>/elements.txt` (`Name | emoji`).
2. Add recipes to `data/<mode>/combinations.txt` (`First + Second = Result`).
3. For a new song or film, add a line to `targets.txt` and at least one recipe that makes it.
4. **A whole new mode** (games, books, sport...): copy the `data/film` folder, rename it, and edit the
   four files. It appears as a new tab automatically. (Optionally add its confetti emoji to
   `CONFETTI_SYMBOLS` in `web/game.js`.)
5. Restart the server. It checks for typos, unknown names and duplicate pairs. It also prints how many
   combinations each song takes and warns if a song can't be reached from the starters.

## Gameplay features

- Drag blocks from the sidebar onto the board, and drop one on another to combine them
- Click a block to add it to the board, double-click a board block to copy it, drag it back to the list to remove it
- Every element plays its own note (Web Audio), with a fanfare and confetti when you win
- Hints (+3 moves), a move counter and timer, a par for each song, and a leaderboard stored in SQLite
- Free play mode with no goal, where discoveries are saved in the browser
