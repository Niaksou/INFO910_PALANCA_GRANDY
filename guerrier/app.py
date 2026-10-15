"""Pod Royale — le guerrier.

Chaque pod du Deployment `guerrier` est un combattant. Il attaque « quelqu'un »
en appelant le Service `guerrier` : c'est kube-proxy qui choisit la cible.
"""
import json
import logging
import os
import random
import signal
import sys
import threading
import time

import redis
import requests
from flask import Flask, jsonify, request
from waitress import serve

from names import accord, display_name

# --- Configuration (ConfigMap en env + Downward API + Secret) ----------------
POD_NAME = os.environ.get("POD_NAME", "guerrier-local")
POD_IP = os.environ.get("POD_IP", "127.0.0.1")
NODE_NAME = os.environ.get("NODE_NAME", "local")
REDIS_HOST = os.environ.get("REDIS_HOST", "localhost")
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.environ.get("REDIS_PASSWORD") or None
TARGET_URL = os.environ.get("TARGET_URL", "http://guerrier.pod-royale.svc.cluster.local:8080/hit")
ATTACK_INTERVAL_MS = int(os.environ.get("ATTACK_INTERVAL_MS", "1200"))
# Âge max de la dernière itération avant que /healthz échoue. La spec propose 10 s,
# mais avec la livenessProbe (période 3 s, seuil 3) le redémarrage arriverait vers 16-19 s :
# 5 s garantit un redémarrage en moins de 15 s.
HEALTHZ_MAX_AGE_S = float(os.environ.get("HEALTHZ_MAX_AGE_S", "5"))
CLASSES_FILE = os.environ.get("CLASSES_FILE", "/config/classes.json")

KEY_STATE = "pr:game:state"
KEY_ROUND = "pr:game:round"
KEY_FIGHTERS = "pr:fighters"
KEY_EVENTS = "pr:events"
MY_KEY = f"pr:fighter:{POD_NAME}"
MY_HEARTBEAT = f"pr:heartbeat:{POD_NAME}"

DEFAULT_CLASSES = [
    {"id": "barbare", "emoji": "🪓", "label": "Barbare", "max_hp": 130, "dmg_min": 8,
     "dmg_max": 14, "crit_chance": 0.10, "crit_mult": 2.0, "weight": 1},
]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stdout)
log = logging.getLogger("guerrier")
logging.getLogger("waitress").setLevel(logging.WARNING)

r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, password=REDIS_PASSWORD,
                decode_responses=True, socket_timeout=2, socket_connect_timeout=2)

# Décrément des PV + détection de mort, atomiques côté Redis.
# KEYS[1] = hash cible, KEYS[2] = hash attaquant ; ARGV[1] = dégâts, ARGV[2] = round courant
# Retour : {code, hp, status} avec code = 1 (tué), 0 (touché), -1 (cible invalide)
HIT_LUA = """
local st = redis.call('HMGET', KEYS[1], 'status', 'round', 'hp')
if st[1] ~= 'alive' or st[2] ~= ARGV[2] then
  return {-1, tonumber(st[3] or 0), st[1] or 'unknown'}
end
local hp = redis.call('HINCRBY', KEYS[1], 'hp', -tonumber(ARGV[1]))
if hp <= 0 then
  redis.call('HSET', KEYS[1], 'hp', 0, 'status', 'dead')
  if KEYS[1] ~= KEYS[2] and redis.call('EXISTS', KEYS[2]) == 1 then
    redis.call('HINCRBY', KEYS[2], 'kills', 1)
  end
  return {1, 0, 'dead'}
end
return {0, hp, 'alive'}
"""
hit_script = r.register_script(HIT_LUA)

KILL_VERBS = [
    "a pulvérisé", "a envoyé au CrashLoopBackOff", "a évincé du nœud", "a OOMKillé",
    "a scale à zéro", "a mis en ImagePullBackOff", "a renvoyé en Pending", "a fait un kubectl delete sur",
]
SELF_HIT_MESSAGES = [
    "{name} s'est pris les pieds dans sa propre épée (-{dmg} PV)",
    "{name} a fait un curl sur son propre Service (-{dmg} PV)",
    "{name} s'est assommé{e} avec son bouclier (-{dmg} PV)",
    "{name} a glissé sur un YAML mal indenté (-{dmg} PV)",
    "{name} a été load-balancé{e} sur {soi} (-{dmg} PV)",
]

# --- État local --------------------------------------------------------------
last_tick = time.time()
frozen = threading.Event()
registered = False


def load_classes():
    try:
        with open(CLASSES_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        log.warning("classes.json illisible (%s), classe par défaut", e)
        return DEFAULT_CLASSES


CLASSES = load_classes()
CLASSES_BY_ID = {c["id"]: c for c in CLASSES}
MY_NAME = display_name(POD_NAME)
E = accord(POD_NAME)  # "e" si le guerrier est une guerrière
my_class = random.choices(CLASSES, weights=[c.get("weight", 1) for c in CLASSES])[0]


def push_event(kind, text):
    event = json.dumps({"ts": time.time(), "type": kind, "text": text}, ensure_ascii=False)
    pipe = r.pipeline()
    pipe.lpush(KEY_EVENTS, event)
    pipe.ltrim(KEY_EVENTS, 0, 49)
    pipe.execute()


def register():
    """S'inscrit dans Redis (ou se réinscrit après un redémarrage du conteneur)."""
    global my_class
    existing = r.hgetall(MY_KEY)
    r.sadd(KEY_FIGHTERS, POD_NAME)
    r.set(MY_HEARTBEAT, "1", ex=5)
    if existing:
        # Même pod, nouveau conteneur : on garde son identité et sa classe.
        my_class = CLASSES_BY_ID.get(existing.get("class"), my_class)
        restarts = r.hincrby(MY_KEY, "restarts", 1)
        r.hset(MY_KEY, mapping={"class": my_class["id"], "node": NODE_NAME})
        push_event("restart", f"🧟 {MY_NAME} revient d'entre les morts (redémarrage n°{restarts})")
        log.info("réinscrit après redémarrage n°%s", restarts)
        return
    state = r.get(KEY_STATE) or "waiting"
    current_round = r.get(KEY_ROUND) or "0"
    r.hset(MY_KEY, mapping={
        "name": MY_NAME, "class": my_class["id"], "hp": my_class["max_hp"],
        "max_hp": my_class["max_hp"], "kills": 0, "round": current_round,
        "status": "alive" if state == "waiting" else "spectator",
        "pod": POD_NAME, "node": NODE_NAME, "restarts": 0,
    })
    push_event("join", f"🚪 {MY_NAME} ({my_class['emoji']} {my_class['label']}) entre dans l'arène")
    log.info("inscrit : %s, %s, %s PV", MY_NAME, my_class["label"], my_class["max_hp"])


# --- Boucle d'attaque --------------------------------------------------------
def attack_once():
    global registered
    if not registered:
        # Inscription faite ici (et pas avant de lancer le serveur HTTP) : si Redis n'est
        # pas encore prêt, /healthz répond quand même et la livenessProbe ne nous tue pas.
        register()
        registered = True
        return
    pipe = r.pipeline()
    pipe.set(MY_HEARTBEAT, "1", ex=5)
    pipe.get(KEY_STATE)
    pipe.get(KEY_ROUND)
    pipe.hmget(MY_KEY, "status", "round")
    _, state, current_round, (status, my_round) = pipe.execute()
    if status is None:
        # Mon hash a disparu (Redis vidé, nettoyage de l'arène…) : je me réinscris.
        register()
        return
    if frozen.is_set() or state != "fighting" or status != "alive" or my_round != current_round:
        return

    damage = random.randint(my_class["dmg_min"], my_class["dmg_max"])
    crit = random.random() < my_class["crit_chance"]
    if crit:
        damage = int(round(damage * my_class["crit_mult"]))
    payload = {"attacker_pod": POD_NAME, "attacker_name": MY_NAME, "damage": damage, "crit": crit}
    try:
        # Pas de Session et "Connection: close" : une nouvelle connexion TCP par attaque,
        # donc kube-proxy choisit une nouvelle cible à chaque fois.
        resp = requests.post(TARGET_URL, json=payload, timeout=1, headers={"Connection": "close"})
    except requests.RequestException as e:
        log.info("⚔  %s : attaque dans le vide (%s)", POD_NAME, type(e).__name__)
        return
    if resp.status_code != 200:
        log.info("⚔  %s → ??? : refusé (%s)", POD_NAME, resp.status_code)
        return
    data = resp.json()
    log.info("⚔  %s → %s : -%s%s, reste %s PV%s", POD_NAME, data["target_pod"], damage,
             " CRIT" if crit else "", data["hp"], " ☠ KILL" if data["killed"] else "")


def attack_loop():
    global last_tick
    while True:
        if not frozen.is_set():
            last_tick = time.time()
        try:
            attack_once()
        except Exception as e:  # Redis indisponible, etc. : on réessaie au prochain tour
            log.warning("boucle d'attaque : %s", e)
        jitter = random.uniform(0.7, 1.3)
        time.sleep(ATTACK_INTERVAL_MS * jitter / 1000)


# --- API HTTP ----------------------------------------------------------------
app = Flask(__name__)


@app.post("/hit")
def hit():
    body = request.get_json(force=True, silent=True) or {}
    attacker_pod = str(body.get("attacker_pod", "?"))
    attacker_name = str(body.get("attacker_name", "Un inconnu"))
    damage = max(1, int(body.get("damage", 1)))
    crit = bool(body.get("crit", False))
    self_hit = attacker_pod == POD_NAME
    if self_hit:
        damage = max(1, int(round(damage * 0.3)))

    current_round = r.get(KEY_ROUND) or "0"
    code, hp, status = hit_script(keys=[MY_KEY, f"pr:fighter:{attacker_pod}"],
                                  args=[damage, current_round])
    if code == -1:
        return jsonify(error="hors combat", status=status), (410 if status == "dead" else 409)

    killed = code == 1
    if self_hit:
        if killed:
            push_event("kill", f"🤦 {MY_NAME} s'est éliminé{E} tout{E} seul{E}. Darwin approuve.")
        else:
            push_event("self", "🤕 " + random.choice(SELF_HIT_MESSAGES).format(
                name=MY_NAME, dmg=damage, e=E, soi="elle-même" if E else "lui-même"))
    elif killed:
        push_event("kill", f"☠️ {attacker_name} {random.choice(KILL_VERBS)} {MY_NAME}")
    elif crit:
        push_event("crit", f"💥 CRITIQUE ! {attacker_name} inflige {damage} dégâts à {MY_NAME}")
    if killed:
        log.info("☠  %s éliminé par %s", POD_NAME, attacker_pod)

    return jsonify(target_pod=POD_NAME, target_name=MY_NAME, hp=hp, killed=killed, status=status)


@app.get("/ready")
def ready():
    # readinessProbe : un mort sort des endpoints du Service, plus personne ne le frappe.
    try:
        status = r.hget(MY_KEY, "status")
    except redis.RedisError:
        return "redis indisponible", 503
    if status == "dead":
        return "mort", 503
    return "prêt", 200


@app.get("/healthz")
def healthz():
    # livenessProbe : si la boucle d'attaque est bloquée, Kubernetes redémarre le conteneur.
    age = time.time() - last_tick
    if age > HEALTHZ_MAX_AGE_S:
        return f"boucle figée depuis {age:.1f}s", 500
    return "ok", 200


@app.post("/freeze")
def freeze():
    frozen.set()
    log.info("🧊 %s est figé (la livenessProbe va échouer)", POD_NAME)
    try:
        push_event("freeze", f"🧊 {MY_NAME} se fige sur place…")
    except redis.RedisError:
        pass
    return jsonify(frozen=True, pod=POD_NAME)


@app.get("/")
def identity():
    hp = r.hget(MY_KEY, "hp")
    return jsonify(pod=POD_NAME, name=MY_NAME, ip=POD_IP, node=NODE_NAME,
                   **{"class": my_class["id"]}, hp=int(hp) if hp is not None else None,
                   frozen=frozen.is_set())


# --- Arrêt propre ------------------------------------------------------------
def on_sigterm(signum, frame):
    try:
        if frozen.is_set():
            # SIGTERM envoyé par le kubelet après l'échec de la livenessProbe :
            # le pod reste, seul le conteneur redémarre. On garde le hash et on
            # prolonge le heartbeat pour que l'arène ne nous oublie pas entre-temps.
            push_event("liveness", f"💔 {MY_NAME} ne répond plus : la livenessProbe l'achève")
            r.set(MY_HEARTBEAT, "1", ex=30)
        else:
            push_event("sigterm", f"⚡ {MY_NAME} a été foudroyé{E} par les dieux (kubectl delete)")
            pipe = r.pipeline()
            pipe.srem(KEY_FIGHTERS, POD_NAME)
            pipe.delete(MY_KEY, MY_HEARTBEAT)
            pipe.execute()
        log.info("SIGTERM reçu, au revoir")
    except Exception as e:
        log.warning("nettoyage incomplet : %s", e)
    sys.stdout.flush()
    os._exit(0)


def main():
    signal.signal(signal.SIGTERM, on_sigterm)
    threading.Thread(target=attack_loop, daemon=True).start()
    serve(app, host="0.0.0.0", port=8080, threads=8)


if __name__ == "__main__":
    main()
