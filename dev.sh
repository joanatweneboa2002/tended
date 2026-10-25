#!/usr/bin/env bash
# Start, stop or restart Tended's backend (port 8000) and frontend (port 5173)
# in the background, one process each. Logs go to logs/.
#
#   ./dev.sh start      start both
#   ./dev.sh stop       stop both (the whole process tree, not just the port)
#   ./dev.sh restart    stop, then start
#   ./dev.sh status     show what's running

set -u
cd "$(dirname "$0")"
mkdir -p logs

port_pid() { lsof -ti :"$1" -sTCP:LISTEN 2>/dev/null | head -1; }

kill_tree() {  # kill a process and all of its children
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null
}

stop_port() {
  local port=$1 name=$2 pid parent
  pid=$(port_pid "$port")
  if [ -z "$pid" ]; then echo "$name: not running"; return; fi
  parent=$(ps -o ppid= -p "$pid" | tr -d ' ')
  kill_tree "$pid"
  # npm run dev is the frontend's parent; stop it too (never a terminal shell)
  if ps -o command= -p "$parent" 2>/dev/null | grep -q "npm"; then kill "$parent" 2>/dev/null; fi
  for _ in $(seq 1 20); do [ -z "$(port_pid "$port")" ] && break; sleep 0.25; done
  if [ -n "$(port_pid "$port")" ]; then kill -9 "$(port_pid "$port")" 2>/dev/null; fi
  echo "$name: stopped"
}

start() {
  if [ -n "$(port_pid 8000)" ]; then
    echo "backend: already running on port 8000 (use ./dev.sh restart)"
  else
    nohup .venv/bin/uvicorn backend.main:app --port 8000 > logs/backend.log 2>&1 &
    echo "backend: starting on http://localhost:8000 (log: logs/backend.log)"
  fi
  if [ -n "$(port_pid 5173)" ]; then
    echo "frontend: already running on port 5173 (use ./dev.sh restart)"
  else
    (cd frontend && nohup npm run dev > ../logs/frontend.log 2>&1 &)
    echo "frontend: starting on http://localhost:5173 (log: logs/frontend.log)"
  fi
  for _ in $(seq 1 40); do
    curl -sf --max-time 2 localhost:5173/api/status > /dev/null 2>&1 && { echo "ready: open http://localhost:5173"; return; }
    sleep 0.5
  done
  echo "not ready after 20s; check logs/backend.log and logs/frontend.log"
}

status() {
  local b f
  b=$(port_pid 8000); f=$(port_pid 5173)
  if [ -n "$b" ]; then echo "backend:  running (pid $b)"; else echo "backend:  not running"; fi
  if [ -n "$f" ]; then echo "frontend: running (pid $f)"; else echo "frontend: not running"; fi
}

case "${1:-}" in
  start) start ;;
  stop) stop_port 8000 backend; stop_port 5173 frontend ;;
  restart) stop_port 8000 backend; stop_port 5173 frontend; start ;;
  status) status ;;
  *) echo "usage: ./dev.sh start|stop|restart|status"; exit 1 ;;
esac
