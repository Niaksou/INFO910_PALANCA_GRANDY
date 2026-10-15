#!/usr/bin/env bash
# Supprime tout le projet. Le PVC de Redis (data-redis-0) est supprimé avec le namespace :
# le tableau d'honneur est donc perdu.
set -euo pipefail
kubectl delete namespace pod-royale --ignore-not-found
echo "🧹 Namespace pod-royale supprimé (PVC et tableau d'honneur compris)."
