#!/usr/bin/env bash
# Construit les images guerrier et arena, et les rend disponibles au cluster local.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTEXT="$(kubectl config current-context 2>/dev/null || true)"
echo "Contexte kubectl : ${CONTEXT:-aucun}"

build() {
  docker build -t pod-royale/guerrier:1.0 guerrier/
  docker build -t pod-royale/arena:1.0 arena/
}

case "$CONTEXT" in
  minikube*)
    echo "→ minikube : build directement dans le démon Docker de minikube"
    eval "$(minikube docker-env)"
    build
    ;;
  kind-*)
    CLUSTER="${CONTEXT#kind-}"
    echo "→ kind : build local puis chargement dans le cluster « $CLUSTER »"
    build
    kind load docker-image pod-royale/guerrier:1.0 --name "$CLUSTER"
    kind load docker-image pod-royale/arena:1.0 --name "$CLUSTER"
    ;;
  *)
    echo "→ contexte inconnu : build dans le Docker local (ok pour Docker Desktop)"
    build
    ;;
esac

echo "✅ Images pod-royale/guerrier:1.0 et pod-royale/arena:1.0 prêtes"
