#!/usr/bin/env bash
# Applique les manifests (sans le dossier bonus) et attend que tout soit prêt.
set -euo pipefail
cd "$(dirname "$0")/.."

# kubectl apply -f k8s/ ne descend pas dans les sous-dossiers : k8s/bonus/ est ignoré
kubectl apply -f k8s/

echo "⏳ Attente des déploiements…"
kubectl -n pod-royale rollout status statefulset/redis --timeout=180s
kubectl -n pod-royale rollout status deployment/guerrier --timeout=180s
kubectl -n pod-royale rollout status deployment/arena --timeout=180s

cat <<MSG

✅ Pod Royale est déployé !

  URL : http://pod-royale.local

  Avec minikube :
    minikube addons enable ingress
    echo "\$(minikube ip) pod-royale.local" | sudo tee -a /etc/hosts
    (avec le driver docker sur macOS : lancer « minikube tunnel » et utiliser 127.0.0.1)

  Sans Ingress :
    kubectl -n pod-royale port-forward svc/arena 8080:80
    puis http://localhost:8080
MSG
