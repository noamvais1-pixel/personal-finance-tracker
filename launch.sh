#!/bin/bash
# Starts the finance tracker if it is not running. With --no-open it does not open a browser (the app window does that).
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="/opt/homebrew/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node || echo /usr/local/bin/node)"
PORT="${PORT:-3124}"
URL="http://localhost:$PORT"
alive() { curl -s --max-time 2 "$URL/api/state" >/dev/null 2>&1; }

if ! alive; then
  cd "$DIR" || { osascript -e 'display alert "מעקב כספים" message "תיקיית התוכנה לא נמצאה."'; exit 1; }
  mkdir -p data
  [ -f data/finance.log ] && [ "$(stat -f%z data/finance.log)" -gt 5000000 ] && : > data/finance.log
  PORT="$PORT" nohup "$NODE" src/finance.js >> data/finance.log 2>&1 &
  for i in $(seq 1 40); do sleep 0.5; alive && break; done
  if ! alive; then
    osascript -e 'display alert "מעקב כספים" message "התוכנה לא עלתה. לפתוח טרמינל בתיקיית התוכנה ולהריץ: npm start   כדי לראות את השגיאה."'
    exit 1
  fi
fi
[ "$1" = "--no-open" ] || open "$URL"
