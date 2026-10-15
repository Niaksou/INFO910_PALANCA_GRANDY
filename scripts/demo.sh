#!/usr/bin/env bash
# Démo interactive : chaque étape montre une notion Kubernetes en direct dans l'arène.
set -uo pipefail
NS=pod-royale
K="kubectl -n $NS"

step() {
  echo
  echo "════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "════════════════════════════════════════════════════════════"
  echo "  $2"
  echo
}
pause() { read -r -p "⏎  Entrée pour continuer…" _; }
run() { echo "\$ $*"; "$@"; }
# Un guerrier au hasard (portable macOS/Linux, sans shuf)
random_guerrier() {
  $K get pods -l app=guerrier --field-selector=status.phase=Running -o name \
    | awk -v seed="$RANDOM" 'BEGIN { srand(seed) } { a[NR] = $0 } END { print a[int(rand() * NR) + 1] }' \
    | cut -d/ -f2
}

step "1/8 — Vue d'ensemble" "Deployments, StatefulSet, Services, pods : tout ce qui compose le jeu."
run $K get all
pause

step "2/8 — Endpoints et readinessProbe" \
  "Les guerriers morts échouent /ready et sortent des endpoints : plus personne ne peut les frapper."
run $K get endpoints guerrier
echo "(relance pendant un round : la liste rétrécit au fil des éliminations)"
pause
run $K get endpoints guerrier
pause

step "3/8 — Scale up" "Des renforts arrivent ! 12 réplicas = 12 combattants (spectateurs jusqu'au prochain round)."
run $K scale deploy/guerrier --replicas=12
run $K get pods -l app=guerrier
pause

VICTIME=$(random_guerrier)
step "4/8 — Foudre divine" "kubectl delete pod $VICTIME : SIGTERM → « foudroyé par les dieux », puis le Deployment recrée un pod."
run $K delete pod "$VICTIME" --wait=false
sleep 2
run $K get pods -l app=guerrier
pause

FIGE=$(random_guerrier)
step "5/8 — livenessProbe" "$FIGE se fige : /healthz échoue, Kubernetes redémarre le conteneur (RESTARTS +1). Ctrl+C pour arrêter le watch."
run $K exec "$FIGE" -- curl -s -X POST localhost:8080/freeze
echo
$K get pod "$FIGE" -w || true
pause

step "6/8 — StatefulSet + PVC" "On tue Redis : redis-0 revient avec le même PVC, le tableau d'honneur est conservé."
run $K get pvc
run $K exec redis-0 -- sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ZREVRANGE pr:halloffame 0 4 WITHSCORES'
run $K delete pod redis-0
run $K rollout status statefulset/redis
run $K exec redis-0 -- sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ZREVRANGE pr:halloffame 0 4 WITHSCORES'
pause

step "7/8 — ConfigMap : mode frénésie" "ATTACK_INTERVAL_MS passe à 400, puis rollout restart pour relire la config."
run $K patch configmap jeu-config --type merge -p '{"data":{"ATTACK_INTERVAL_MS":"400"}}'
run $K rollout restart deploy/guerrier
run $K rollout status deploy/guerrier
pause

step "8/8 — Le duel final" "Plus que 2 réplicas : un contre un."
run $K scale deploy/guerrier --replicas=2
pause

echo
echo "🏁 Fin de la démo. Pour revenir aux règles normales :"
echo "   $K patch configmap jeu-config --type merge -p '{\"data\":{\"ATTACK_INTERVAL_MS\":\"1200\"}}'"
echo "   $K rollout restart deploy/guerrier && $K scale deploy/guerrier --replicas=6"
