"""Pod Royale — l'arène.

Un seul réplica : c'est l'arbitre. Il gère les rounds dans un thread de fond
et sert l'interface (rendue côté serveur) + /api/state sur la même origine.
"""
import json
import logging
import os
import sys
import threading
import time

import redis
from flask import Flask, jsonify, render_template
from waitress import serve

REDIS_HOST = os.environ.get("REDIS_HOST", "localhost")
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.environ.get("REDIS_PASSWORD") or None
VICTORY_PAUSE_S = float(os.environ.get("VICTORY_PAUSE_S", "8"))
CLASSES_FILE = os.environ.get("CLASSES_FILE", "/config/classes.json")

KEY_STATE = "pr:game:state"
KEY_ROUND = "pr:game:round"
KEY_VICTORY_AT = "pr:game:victory_at"
KEY_WINNER = "pr:game:winner"
KEY_FIGHTERS = "pr:fighters"
KEY_EVENTS = "pr:events"
KEY_HOF = "pr:halloffame"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stdout)
log = logging.getLogger("arena")
logging.getLogger("waitress").setLevel(logging.WARNING)

r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, password=REDIS_PASSWORD,
                decode_responses=True, socket_timeout=2, socket_connect_timeout=2)


def load_classes():
    try:
        with open(CLASSES_FILE, encoding="utf-8") as f:
            return {c["id"]: c for c in json.load(f)}
    except (OSError, ValueError) as e:
        log.warning("classes.json illisible (%s)", e)
        return {}


CLASSES = load_classes()


def class_info(class_id):
    c = CLASSES.get(class_id, {})
    return c.get("emoji", "⚔️"), c.get("label", class_id or "?")


def push_event(kind, text):
    log.info(text)
    event = json.dumps({"ts": time.time(), "type": kind, "text": text}, ensure_ascii=False)
    pipe = r.pipeline()
    pipe.lpush(KEY_EVENTS, event)
    pipe.ltrim(KEY_EVENTS, 0, 49)
    pipe.execute()


def fighter_key(pod):
    return f"pr:fighter:{pod}"


def load_fighters():
    """Retourne {pod: hash} pour les pods présents, et la liste des pods sans heartbeat."""
    pods = sorted(r.smembers(KEY_FIGHTERS))
    if not pods:
        return {}, []
    pipe = r.pipeline()
    for pod in pods:
        pipe.exists(f"pr:heartbeat:{pod}")
        pipe.hgetall(fighter_key(pod))
    res = pipe.execute()
    present, ghosts = {}, []
    for i, pod in enumerate(pods):
        alive_hb, data = res[2 * i], res[2 * i + 1]
        if alive_hb and data:
            present[pod] = data
        else:
            ghosts.append((pod, data))
    return present, ghosts


# --- Boucle d'arbitrage ------------------------------------------------------
def referee_tick():
    present, ghosts = load_fighters()
    for pod, data in ghosts:
        pipe = r.pipeline()
        pipe.srem(KEY_FIGHTERS, pod)
        pipe.delete(fighter_key(pod))
        pipe.execute()
        push_event("ghost", f"👻 {(data or {}).get('name', pod)} a disparu sans laisser de trace")

    state = r.get(KEY_STATE) or "waiting"
    current_round = int(r.get(KEY_ROUND) or 0)
    alive = [d for d in present.values()
             if d.get("status") == "alive" and d.get("round") == str(current_round)]

    if state == "waiting":
        if len(present) >= 2:
            current_round = r.incr(KEY_ROUND)
            pipe = r.pipeline()
            for pod, d in present.items():
                pipe.hset(fighter_key(pod), mapping={
                    "hp": d.get("max_hp", 100), "status": "alive", "kills": 0, "round": current_round,
                })
            pipe.set(KEY_STATE, "fighting")
            pipe.execute()
            push_event("round", f"🔔 ROUND {current_round} — {len(present)} combattants. FIGHT !")

    elif state == "fighting":
        if len(alive) == 1:
            winner = alive[0]
            _, label = class_info(winner.get("class"))
            pipe = r.pipeline()
            pipe.zincrby(KEY_HOF, 1, f"{winner['name']} ({label})")
            pipe.set(KEY_STATE, "victory")
            pipe.set(KEY_VICTORY_AT, time.time())
            pipe.set(KEY_WINNER, winner["pod"])
            pipe.execute()
            kills = int(winner.get("kills", 0))
            push_event("victory", f"🏆 {winner['name']} remporte le round {current_round} "
                                  f"avec {kills} élimination{'s' if kills > 1 else ''} !")
        elif len(alive) == 0:
            pipe = r.pipeline()
            pipe.set(KEY_STATE, "victory")
            pipe.set(KEY_VICTORY_AT, time.time())
            pipe.set(KEY_WINNER, "")
            pipe.execute()
            push_event("victory", "💀 Double KO, personne ne gagne")

    elif state == "victory":
        victory_at = float(r.get(KEY_VICTORY_AT) or 0)
        if time.time() - victory_at > VICTORY_PAUSE_S:
            # Les spectateurs deviendront alive au prochain passage en fighting.
            r.set(KEY_STATE, "waiting")


def referee_loop():
    initialized = False
    while True:
        try:
            if not initialized:
                init_game()
                initialized = True
            referee_tick()
        except redis.RedisError as e:
            log.warning("arbitre : Redis indisponible (%s)", e)
        except Exception:
            log.exception("arbitre : erreur inattendue")
        time.sleep(1)


def init_game():
    """Première partie : état "waiting", round 0 (sans écraser un état existant)."""
    r.setnx(KEY_STATE, "waiting")
    r.setnx(KEY_ROUND, 0)


# --- État exposé au navigateur ----------------------------------------------
STATUS_ORDER = {"alive": 0, "spectator": 1, "dead": 2}


def game_state():
    present, _ = load_fighters()
    pipe = r.pipeline()
    pipe.get(KEY_STATE)
    pipe.get(KEY_ROUND)
    pipe.get(KEY_WINNER)
    pipe.lrange(KEY_EVENTS, 0, 29)
    pipe.zrevrange(KEY_HOF, 0, 9, withscores=True)
    state, current_round, winner_pod, events, hof = pipe.execute()
    current_round = int(current_round or 0)

    fighters = []
    for pod, d in present.items():
        status = d.get("status", "spectator")
        if status == "alive" and d.get("round") != str(current_round):
            status = "spectator"
        emoji, label = class_info(d.get("class"))
        fighters.append({
            "pod": pod, "name": d.get("name", pod), "class": d.get("class"),
            "emoji": emoji, "label": label, "status": status,
            "hp": int(d.get("hp", 0)), "max_hp": int(d.get("max_hp", 1)),
            "kills": int(d.get("kills", 0)), "restarts": int(d.get("restarts", 0)),
            "node": d.get("node", "?"),
        })
    fighters.sort(key=lambda f: (STATUS_ORDER.get(f["status"], 3), -f["hp"], f["name"]))

    winner = None
    if state == "victory" and winner_pod:
        w = present.get(winner_pod) or r.hgetall(fighter_key(winner_pod))
        if w:
            emoji, label = class_info(w.get("class"))
            winner = {"pod": winner_pod, "name": w.get("name", winner_pod), "emoji": emoji,
                      "label": label, "kills": int(w.get("kills", 0))}

    return {
        "state": state or "waiting",
        "round": current_round,
        "alive": sum(1 for f in fighters if f["status"] == "alive"),
        "present": len(fighters),
        "fighters": fighters,
        "events": [json.loads(e) for e in events],
        "halloffame": [{"name": name, "wins": int(score)} for name, score in hof],
        "winner": winner,
    }


app = Flask(__name__)


@app.get("/")
def index():
    try:
        initial = game_state()
    except redis.RedisError:
        initial = {"state": "waiting", "round": 0, "alive": 0, "present": 0, "fighters": [],
                   "events": [], "halloffame": [], "winner": None}
    return render_template("index.html", s=initial)


@app.get("/api/state")
def api_state():
    try:
        return jsonify(game_state())
    except redis.RedisError as e:
        return jsonify(error=f"Redis indisponible : {e}"), 503


@app.get("/healthz")
def healthz():
    try:
        r.ping()
        return "ok", 200
    except redis.RedisError:
        return "redis KO", 500


def main():
    threading.Thread(target=referee_loop, daemon=True).start()
    serve(app, host="0.0.0.0", port=8080, threads=8)


if __name__ == "__main__":
    main()
