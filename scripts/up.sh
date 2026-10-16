#!/usr/bin/env bash
# Lance Pod Royale en une seule commande : Docker, cluster, images, déploiement,
# puis ouvre l'arène dans le navigateur via un port-forward (pas de sudo, pas de /etc/hosts).
# macOS, Linux, WSL et Git Bash. Sous Windows (PowerShell) : scripts\up.ps1
#
#   ./scripts/up.sh                  arène sur http://localhost:8080
#   PORT=9090 ./scripts/up.sh        autre port local
#   NO_BROWSER=1 ./scripts/up.sh     ne pas ouvrir le navigateur
#   INGRESS=1 ./scripts/up.sh        activer aussi l'addon ingress de minikube (pod-royale.local)
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8080}"
URL="http://localhost:$PORT"

case "$(uname -s)" in
  Darwin) OS=macos ;;
  Linux)
    if grep -qi microsoft /proc/version 2>/dev/null; then OS=wsl; else OS=linux; fi ;;
  MINGW*|MSYS*|CYGWIN*) OS=gitbash ;;
  *) OS=autre ;;
esac
echo "🖥  Système : $OS"

need() { command -v "$1" >/dev/null || { echo "❌ $1 introuvable. $2" >&2; exit 1; }; }
need docker  "Installer Docker : https://docs.docker.com/get-docker/"
need kubectl "Installer kubectl : https://kubernetes.io/docs/tasks/tools/"

# 1. Docker doit tourner (sur macOS on lance Docker Desktop si besoin)
if ! docker info >/dev/null 2>&1; then
  if [[ $OS == macos ]] && open -a Docker 2>/dev/null; then
    echo "⏳ Démarrage de Docker Desktop…"
    for _ in $(seq 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
  fi
  if ! docker info >/dev/null 2>&1; then
    case $OS in
      linux) echo "❌ Docker ne répond pas : sudo systemctl start docker (et ajoutez-vous au groupe docker)" >&2 ;;
      *)     echo "❌ Docker ne répond pas : lancez Docker Desktop puis relancez ce script" >&2 ;;
    esac
    exit 1
  fi
fi

# 2. Un cluster joignable : celui du contexte courant, sinon on démarre minikube
if kubectl get --raw=/readyz --request-timeout=5s >/dev/null 2>&1; then
  echo "☸️  Cluster joignable : $(kubectl config current-context)"
else
  need minikube "Aucun cluster joignable : installez minikube (https://minikube.sigs.k8s.io) ou démarrez votre cluster."
  echo "☸️  Démarrage de minikube…"
  minikube start
fi
# L'accès passe par un port-forward : le contrôleur nginx ne sert que pour pod-royale.local
if [[ -n "${INGRESS:-}" && "$(kubectl config current-context)" == minikube* ]]; then
  minikube addons enable ingress >/dev/null
fi

# 3. Images + déploiement (bash explicite : le bit exécutable peut manquer sous Windows)
bash scripts/build.sh
bash scripts/deploy.sh

# 4. Accès à l'arène : le port-forward marche pareil sur tous les OS et drivers
echo
echo "🔌 Port-forward svc/arena → $URL"
kubectl -n pod-royale port-forward svc/arena "$PORT:80" >/dev/null &
PF=$!
trap 'kill "$PF" 2>/dev/null || true' EXIT
trap 'exit 130' INT TERM

for _ in $(seq 40); do
  kill -0 "$PF" 2>/dev/null || { echo "❌ Port-forward impossible (port $PORT déjà pris ? essayez PORT=9090 $0)" >&2; exit 1; }
  if command -v curl >/dev/null; then
    curl -s -o /dev/null "$URL" && break
  else
    sleep 2; break
  fi
  sleep 0.5
done

open_url() {
  case $OS in
    macos)   open "$1" ;;
    linux)   xdg-open "$1" ;;
    wsl)     if command -v wslview >/dev/null; then wslview "$1"; else cmd.exe /c start "" "$1"; fi ;;
    gitbash) start "" "$1" ;;
    *)       return 1 ;;
  esac >/dev/null 2>&1
}
[[ -n "${NO_BROWSER:-}" ]] || open_url "$URL" || true

echo
echo "⚔️  Pod Royale tourne : $URL"
echo "   Ctrl+C coupe l'accès (le jeu continue dans le cluster). Tout supprimer : ./scripts/reset.sh"
wait "$PF"
