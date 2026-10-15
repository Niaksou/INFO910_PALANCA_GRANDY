# ⚔️ Pod Royale

**Un battle royale où chaque pod est un guerrier.**
Les guerriers s'attaquent en appelant le Service `guerrier` : c'est le load balancing de Kubernetes qui choisit la victime au hasard.
Les morts échouent leur readinessProbe et sortent des endpoints. Le dernier survivant gagne, puis un nouveau round commence.

Projet INFO910 — Palanca & Grandy.

```text
POD ROYALE                               ROUND 7  [FIGHTING]  3 / 6 en vie
┌──────────────────────────┐ ┌──────────────────────────┐   ┌─ FIL DES COMBATS ──────────────────────┐
│ 🪓 Gérard le Fourbe       │ │ 🏹 Josiane la Sans-Pitié  │   │ ☠️ Josiane a OOMKillé Kevin l'Inoxydable│
│ guerrier-7d9f8b-x2k4p    │ │ guerrier-7d9f8b-q8m1z    │   │ 💥 CRITIQUE ! Gérard inflige 28 dégâts   │
│ ████████████░░░ 98/130   │ │ ██████░░░░░░░░░  41/100  │   │ ⚡ Ginette a été foudroyée par les dieux │
│ ☠️ × 2                    │ │ ☠️ × 1   ↻ 1              │   │ 🔔 ROUND 7 — 6 combattants. FIGHT !     │
└──────────────────────────┘ └──────────────────────────┘   ├─ TABLEAU D'HONNEUR ────────────────────┤
┌──────────────────────────┐ ┌──────────────────────────┐   │ 1. Gérard le Fourbe (Barbare)    3 🏆   │
│ 💀 Kevin l'Inoxydable     │ │ 🔮 Monique la Chauve      │   │ 2. Josiane la Sans-Pitié (Archer) 2 🏆  │
│ ░░░░░░░░░░░░░░░   0/160  │ │       (en attente)       │   └────────────────────────────────────────┘
└──────────────────────────┘ └──────────────────────────┘
```

---

## Architecture

```text
                 Navigateur
                     │  http://pod-royale.local
                     ▼
              ┌─────────────┐
              │   Ingress   │
              └──────┬──────┘
                     ▼
              ┌─────────────┐        lit/écrit l'état
              │ arena (x1)  │ ─────────────────────────┐
              │ Flask + UI  │   gère les rounds        │
              └─────────────┘                          ▼
                                               ┌──────────────┐
   ┌──────────────────────────────┐            │ redis-0      │
   │ Deployment guerrier (xN)     │ ─────────▶ │ StatefulSet  │
   │  ┌────┐ ┌────┐ ┌────┐        │  état PV,  │ + PVC        │
   │  │ g1 │ │ g2 │ │ g3 │ ...    │  events    └──────────────┘
   │  └─┬──┘ └─┬──┘ └─┬──┘        │
   └────┼──────┼──────┼───────────┘
        │      │      │   POST /hit
        └──────┴──────┴──▶ Service "guerrier" (ClusterIP)
                           → pod choisi au hasard par kube-proxy
```

| Composant | Rôle |
|---|---|
| `guerrier/` | Python 3.12 + Flask (waitress). Expose `/hit`, `/ready`, `/healthz`, `/freeze`, `/`. Une boucle d'attaque tourne dans un thread. |
| `arena/` | Python 3.12 + Flask (waitress). L'arbitre : il gère les rounds, sert la page (Jinja2) et `/api/state`. **1 seul réplica.** |
| `redis` | `redis:7-alpine` avec mot de passe et AOF, sur un PVC. Stocke l'état du jeu (clés `pr:*`). La perte de PV et la détection de mort se font dans un script Lua, donc de façon atomique. |

Chaque attaque ouvre une **nouvelle connexion TCP** (pas de `requests.Session`, en-tête `Connection: close`). Sans ça, le keep-alive collerait chaque attaquant à la même cible et le hasard du load balancing disparaîtrait.

---

## Notions du cours → où elles apparaissent

| Notion | Où dans le projet |
|---|---|
| **Pod** | Chaque guerrier est un pod. Son nom de pod donne son nom d'affichage (« Gérard le Fourbe »). |
| **Namespace** | `k8s/00-namespace.yaml` : tout vit dans `pod-royale`, et `reset.sh` supprime tout d'un coup. |
| **Deployment** | `k8s/20-guerrier-deployment.yaml` (6 réplicas, RollingUpdate `maxSurge: 2` / `maxUnavailable: 1`) et `k8s/30-arena-deployment.yaml` (1 réplica, `Recreate`). |
| **Service et DNS** | `k8s/21-guerrier-service.yaml` : la cible des attaques, le load balancing choisit la victime. `redis.pod-royale.svc.cluster.local` est résolu par le DNS du cluster. |
| **StatefulSet** | `k8s/10-redis-statefulset.yaml` : identité stable `redis-0`. |
| **PVC** | `volumeClaimTemplates` de Redis : le tableau d'honneur survit à `kubectl delete pod redis-0`. |
| **ConfigMap (env)** | `jeu-config` via `envFrom` : `ATTACK_INTERVAL_MS`, `VICTORY_PAUSE_S`, `REDIS_HOST`… |
| **ConfigMap (volume)** | La même ConfigMap, montée en `/config/classes.json` : les classes de guerriers. |
| **Secret** | `k8s/01-secret-redis.yaml` : `REDIS_PASSWORD` injecté par `secretKeyRef`. Aucun mot de passe en clair dans les Deployments. |
| **readinessProbe** | `GET /ready` renvoie 503 quand le guerrier est mort, donc il sort des endpoints en ~1 s (`periodSeconds: 1`, `failureThreshold: 1`). |
| **livenessProbe** | `GET /healthz` renvoie 500 si la boucle d'attaque est figée (`/freeze`), donc le conteneur redémarre (RESTARTS +1). |
| **requests / limits** | Sur tous les conteneurs (ex. guerrier : `20m/48Mi` → `200m/128Mi`). |
| **Downward API** | `POD_NAME`, `POD_IP`, `NODE_NAME` injectés depuis `metadata.name`, `status.podIP`, `spec.nodeName`. |
| **Arrêt propre (SIGTERM)** | `terminationGracePeriodSeconds: 10` : le guerrier annonce « ⚡ foudroyé par les dieux » avant de partir. |
| **Ingress** | `k8s/40-ingress.yaml` : `pod-royale.local` → `arena:80`. Seule l'arène est exposée. |
| **Gateway API (bonus)** | `k8s/bonus/41-httproute.yaml` : `Gateway` + `HTTPRoute` équivalents à l'Ingress. Non appliqués par défaut. |

---

## Installation (minikube)

Prérequis : Docker, `kubectl`, `minikube` (ou `kind`).

```bash
# 1. Cluster + contrôleur Ingress
minikube start
minikube addons enable ingress

# 2. Construire les images et les charger dans minikube (minikube image load)
./scripts/build.sh

# 3. Déployer et attendre que tout soit prêt
./scripts/deploy.sh

# 4. Résoudre pod-royale.local vers le cluster
#    Linux, ou minikube avec un driver VM :
echo "$(minikube ip) pod-royale.local" | sudo tee -a /etc/hosts
#    macOS avec le driver docker : l'IP de minikube n'est pas joignable depuis le Mac.
#    Lancer `minikube tunnel` dans un autre terminal (à laisser ouvert), puis :
echo "127.0.0.1 pod-royale.local" | sudo tee -a /etc/hosts

# 5. Ouvrir http://pod-royale.local
```

**Sans Ingress :**

```bash
kubectl -n pod-royale port-forward svc/arena 8080:80
# puis http://localhost:8080
```

Pour tout supprimer : `./scripts/reset.sh` (le PVC, et donc le tableau d'honneur, part avec le namespace).

---

## Déroulé de la démo

`./scripts/demo.sh` enchaîne les étapes, avec une pause entre chacune. L'arène reste ouverte à côté.

| # | Commande | Ce qu'on voit dans l'arène |
|---|---|---|
| 1 | `kubectl get all -n pod-royale` | Tous les objets du jeu |
| 2 | `kubectl get endpoints guerrier -n pod-royale` (pendant un round) | Les morts disparaissent des endpoints (readinessProbe) |
| 3 | `kubectl scale deploy/guerrier --replicas=12` | Des renforts arrivent, en spectateurs jusqu'au prochain round |
| 4 | `kubectl delete pod <guerrier>` | « ⚡ X a été foudroyé par les dieux », puis un nouveau pod apparaît |
| 5 | `kubectl exec <pod> -- curl -X POST localhost:8080/freeze` | Le guerrier se fige, la livenessProbe échoue, RESTARTS +1 et « 🧟 X revient d'entre les morts » |
| 6 | `kubectl delete pod redis-0` | Redis redémarre et le tableau d'honneur est conservé (PVC) |
| 7 | Patch de la ConfigMap `ATTACK_INTERVAL_MS=400` + `kubectl rollout restart deploy/guerrier` | Mode frénésie : les rounds durent quelques secondes |
| 8 | `kubectl scale deploy/guerrier --replicas=2` | Le duel final |

Pour voir le hasard du load balancing : `kubectl -n pod-royale logs -l app=guerrier --prefix | grep '→'`. Chaque ligne indique quel pod a frappé quel pod.

---

## Pourquoi pas de CORS ici

Le navigateur ne parle **qu'à une seule origine** : `http://pod-royale.local`, c'est-à-dire l'arène derrière l'Ingress. La page est rendue côté serveur par Jinja2, et `arena.js` appelle `fetch('/api/state')` avec une URL relative, donc sur la même origine. Il n'y a jamais de requête cross-origin, et aucun en-tête CORS n'est nécessaire.

Les guerriers et Redis ne sont **pas exposés** hors du cluster (Services ClusterIP, pas d'Ingress). L'arène lit l'état dans Redis côté serveur, puis le renvoie au navigateur. C'est plus simple et plus sûr : la surface exposée se limite à une seule application.

---

## Structure

```text
├── guerrier/        app.py, names.py, Dockerfile
├── arena/           app.py, templates/, static/, Dockerfile
├── k8s/             manifests numérotés dans l'ordre d'application (+ bonus/ Gateway API)
└── scripts/         build.sh, deploy.sh, demo.sh, reset.sh
```
