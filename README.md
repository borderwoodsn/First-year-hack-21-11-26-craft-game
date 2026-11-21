# First-year-hack-21-11-26-craft-game
🎵🎬 An 8-bit crafting game where you combine building blocks to create famous songs and films. Inspired by Infinite Craft. Java + SQLite backend, vanilla JS front end.

Created by: Noah Border-Woods, YunFei Fan and Abdul Sesay

Song Craft is a retro 8-bit crafting game inspired by Infinite Craft. You start with a handful of
basic building blocks and combine them to discover new things, until you craft a famous song or film.

Drag **Voice** onto **Person** to get a **Singer**. Mix **Emotion** and **Sound** for a **Melody**.
Keep going: **Rock Opera + Piano** makes **Bohemian Rhapsody**, and **Toy + Story** makes **Toy Story**.

## ✨ Features

- **Two game modes:** 🎵 *Song Craft* (12 iconic songs) and 🎬 *Film Craft* (12 classic films), each with
  its own blocks, art and colours. 1,400+ combinations, with many different routes to every target.
- **Levels with par:** every song/film shows the fewest combinations needed. Can you match it?
- **📅 Daily challenge:** one target a day for everyone, with a move limit and a "fastest time" leaderboard.
- **⏱️ Rush mode:** craft as many targets as you can in 3 minutes, with each one adding time to the clock.
- **👥 Multiplayer races:** host a lobby, share the 4-letter code, and race friends on other devices to
  craft the target first. The server checks every move, so no cheating.
- **📖 Recipe book:** a lifetime collection of everything you've discovered and how you made it.
- **🏅 Achievements & profile:** 20 unlockable badges and personal stats.
- **💡 Player suggestions:** when two things don't combine, players can suggest what they *should* make.
  The host approves ideas on an admin page and they go live instantly, so the game grows with its players.
- **🎨 8-bit arcade style:** pixel art, chiptune sound effects, a themed title screen, light/dark mode.
- **🏆 Leaderboards** for levels, daily challenges and rush mode.

## 🛠️ Built with

- **Backend:** Java 17+ (built-in `HttpServer`, no frameworks) + **SQLite** (via sqlite-jdbc)
- **Frontend:** plain HTML, CSS and JavaScript, no build step
- **Game data:** simple text files (`data/<mode>/combinations.txt` uses `A + B = Result`), so anyone can
  add new combinations or even a whole new mode without touching code

## 🚀 Running it

1. Open the project in IntelliJ and run `src/Main.java`, or double-click `run.bat` (Windows) / `./run.sh`.
2. Open **http://localhost:8080** in your browser.
3. For multiplayer, friends on the same Wi-Fi open `http://<your-computer's-IP>:8080`.
   The lobby screen shows the address.

## ➕ Adding content

Every combination is one line of text. Add `Love + Ship = Titanic` to `data/film/combinations.txt`,
restart the server, and it's in the game. The server checks for typos and duplicates and warns you if
a target can't be reached.

---
*Made in a day at a first-year hackathon.* 🎮
```
