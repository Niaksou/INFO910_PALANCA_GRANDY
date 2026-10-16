#!/usr/bin/env bash
# Applique les manifests (sans le dossier bonus) et attend que tout soit prêt.
set -euo pipefail
cd "$(dirname "$0")/.."

# kubectl apply -f k8s/ ne descend pas dans les sous-dossiers : k8s/bonus/ est ignoré
kubectl apply -f k8s/

# Les images gardent le tag 1.0 : sans changement dans le Deployment, un rebuild ne relance
# aucun pod et l'ancien code continue de tourner. On inscrit une empreinte du code source dans
# le template : si le code change, Kubernetes fait un rollout ; sinon rien ne bouge.
# (Pas l'ID de l'image : buildx en génère un nouveau à chaque build, même sans changement.)
sha() { if command -v sha1sum >/dev/null; then sha1sum; else shasum; fi; }
for app in guerrier arena; do
  files="$(find "$app" -type f ! -path '*/__pycache__/*' | LC_ALL=C sort)"
  hash="$( { echo "$files"; cat $files; } | sha | cut -c1-12)"
  kubectl -n pod-royale patch deployment "$app" --type merge \
    -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"pod-royale/code\":\"$hash\"}}}}}" >/dev/null
done

echo "⏳ Attente des déploiements…"
kubectl -n pod-royale rollout status statefulset/redis --timeout=180s
kubectl -n pod-royale rollout status deployment/guerrier --timeout=180s
kubectl -n pod-royale rollout status deployment/arena --timeout=180s

echo
echo "✅ Pod Royale est déployé ! URL : http://pod-royale.local"
echo

CONTEXT="$(kubectl config current-context 2>/dev/null || true)"
if [[ "$CONTEXT" == minikube* ]] && command -v minikube >/dev/null; then
  DRIVER="$(minikube profile list -o json 2>/dev/null | grep -o '"Driver":"[^"]*"' | head -1 | cut -d'"' -f4)"
  echo "  1. Contrôleur Ingress :  minikube addons enable ingress"
  if [[ "$(uname)" == Darwin && "$DRIVER" == docker ]]; then
    # Driver docker sur macOS : l'IP de minikube n'est pas joignable depuis le Mac
    echo "  2. Dans un autre terminal, à laisser ouvert :  minikube tunnel"
    echo "  3. Une seule fois :  echo \"127.0.0.1 pod-royale.local\" | sudo tee -a /etc/hosts"
  else
    echo "  2. Une seule fois :  echo \"$(minikube ip) pod-royale.local\" | sudo tee -a /etc/hosts"
  fi
fi

echo
echo "  Sans Ingress :  kubectl -n pod-royale port-forward svc/arena 8080:80  →  http://localhost:8080"
