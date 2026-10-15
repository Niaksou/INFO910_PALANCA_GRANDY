#!/usr/bin/env bash
# Construit les images guerrier et arena, et les rend disponibles au cluster local.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTEXT="$(kubectl config current-context 2>/dev/null || true)"
echo "Contexte kubectl : ${CONTEXT:-aucun}"

IMAGES=(pod-royale/guerrier:1.0 pod-royale/arena:1.0)

# --load : force l'image à atterrir dans le Docker local, même si le builder
# buildx par défaut utilise le driver docker-container.
build() {
  docker buildx build --load -t pod-royale/guerrier:1.0 guerrier/
  docker buildx build --load -t pod-royale/arena:1.0 arena/
}

case "$CONTEXT" in
  minikube*)
    # On ne passe pas par `minikube docker-env` : il ne marche pas quand minikube
    # tourne avec containerd. Build local puis `minikube image load`, quel que soit le runtime.
    echo "→ minikube : build local puis chargement dans minikube"
    build
    for img in "${IMAGES[@]}"; do
      echo "   chargement de ${img}…"
      minikube image load "$img" --overwrite=true
    done
    ;;
  kind-*)
    CLUSTER="${CONTEXT#kind-}"
    echo "→ kind : build local puis chargement dans le cluster « $CLUSTER »"
    build
    for img in "${IMAGES[@]}"; do
      kind load docker-image "$img" --name "$CLUSTER"
    done
    ;;
  *)
    echo "→ contexte inconnu : build dans le Docker local (ok pour Docker Desktop)"
    build
    ;;
esac

echo "✅ Images pod-royale/guerrier:1.0 et pod-royale/arena:1.0 prêtes"
