@echo off
rem Compiles and starts Song Craft, then open http://localhost:8080
cd /d "%~dp0"
if exist build rmdir /s /q build
javac -encoding UTF-8 -d build -cp "lib/*" src\*.java || exit /b 1
java -cp "build;lib/*" Main %*
