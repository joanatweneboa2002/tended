#!/usr/bin/env bash
# Start, stop or restart Tended's backend (port 8000, or the next free one)
# and frontend (port 5173, or the next free one) in the background, one
# process each. Logs go to logs/.
#
#   ./dev.sh start      start both
#   ./dev.sh stop       stop both (the whole process tree, not just the port)
#   ./dev.sh restart    stop, then start
#   ./dev.sh status     show what's running

set -u
cd "$(dirname "$0")"
mkdir -p logs

port_pid() { lsof -ti :"$1" -sTCP:LISTEN 2>/dev/null | head -1; }
backend_port() { cat data/backend.port 2>/dev/null || echo 8000; }   # written by python -m backend
frontend_url() { grep -oE 'http://localhost:[0-9]+' logs/frontend.log 2>/dev/null | head -1; }

kill_tree() {  # kill a process and all of its children
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null
}

stop_port() {
  local port=$1 name=$2 pid parent
  pid=$(port_pid "$port")
  if [ -z "$pid" ]; then echo "$name: not running"; return; fi
  # only ever stop Tended itself: another app on this port is left alone
  if ! ps -o command= -p "$pid" | grep -qE "backend|vite"; then
    echo "$name: port $port is used by another app ($(ps -o comm= -p "$pid")); not stopping it"
    return
  fi
  parent=$(ps -o ppid= -p "$pid" | tr -d ' ')
  kill_tree "$pid"
  # npm run dev is the frontend's parent; stop it too (never a terminal shell)
  if ps -o command= -p "$parent" 2>/dev/null | grep -q "npm"; then kill "$parent" 2>/dev/null; fi
  for _ in $(seq 1 20); do [ -z "$(port_pid "$port")" ] && break; sleep 0.25; done
  if [ -n "$(port_pid "$port")" ]; then kill -9 "$(port_pid "$port")" 2>/dev/null; fi
  echo "$name: stopped"
}

start() {
  local fp
  fp=$(frontend_url | grep -oE '[0-9]+$')
  if [ -f data/backend.port ] && [ -n "$(port_pid "$(backend_port)")" ] && [ -n "${fp}" ] && [ -n "$(port_pid "$fp")" ]; then
    echo "already running: backend on $(backend_port), frontend on $fp (use ./dev.sh restart)"
    return
  fi
  stop_all > /dev/null  # a half-running app: start both fresh
  # python -m backend picks 8000, or 8001, 8002… if that's taken, and prints the port
  nohup .venv/bin/python -m backend > logs/backend.log 2>&1 &
  echo "backend: starting (log: logs/backend.log)"
  # Vite uses 5173, or the next free port if that's taken
  : > logs/frontend.log
  (cd frontend && nohup npm run dev > ../logs/frontend.log 2>&1 &)
  echo "frontend: starting (log: logs/frontend.log)"
  for _ in $(seq 1 40); do
    url=$(frontend_url)
    if [ -n "$url" ] && curl -sf --max-time 2 "$url/api/status" > /dev/null 2>&1; then
      echo "backend: http://localhost:$(backend_port)"
      echo "ready: open $url"
      return
    fi
    sleep 0.5
  done
  echo "not ready after 20s; check logs/backend.log and logs/frontend.log"
}

status() {
  local b f bp fp
  bp=$(backend_port); fp=$(frontend_url | grep -oE '[0-9]+$'); fp=${fp:-5173}
  b=$(port_pid "$bp"); f=$(port_pid "$fp")
  if [ -n "$b" ]; then echo "backend:  running on port $bp (pid $b)"; else echo "backend:  not running"; fi
  if [ -n "$f" ]; then echo "frontend: running on port $fp (pid $f)"; else echo "frontend: not running"; fi
}

stop_all() {
  local fp
  fp=$(frontend_url | grep -oE '[0-9]+$')
  stop_port "$(backend_port)" backend
  stop_port "${fp:-5173}" frontend
  rm -f data/backend.port
}

case "${1:-}" in
  start) start ;;
  stop) stop_all ;;
  restart) stop_all; start ;;
  status) status ;;
  *) echo "usage: ./dev.sh start|stop|restart|status"; exit 1 ;;
esac
