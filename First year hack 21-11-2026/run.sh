#!/usr/bin/env sh
# Compiles and starts Song Craft, then open http://localhost:8080
cd "$(dirname "$0")" || exit 1
rm -rf build
javac -encoding UTF-8 -d build -cp "lib/*" src/*.java || exit 1
SEP=":"; case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) SEP=";";; esac
java -cp "build${SEP}lib/*" Main "$@"
