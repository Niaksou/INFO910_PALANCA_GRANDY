// Pod Royale — rafraîchit l'interface autour de l'arène toutes les 700 ms.
// fetch('/api/state') vise la même origine que la page : aucun besoin de CORS.
(function () {
  "use strict";

  const grid = document.getElementById("grid");
  const emptyMsg = document.querySelector(".loges-wrap .empty");
  const lastHp = new Map();

  const PHASES = { waiting: "En attente de combattants", fighting: "Combat en cours", victory: "Victoire" };

  // Marqueurs du crieur, dessinés au trait (pas d'emoji : rendu identique partout)
  const ICONS = {
    kill: "M12 2.5 14 13h-4zM7.5 13.5h9M12 13.5V21",
    victory: "M4 17.5h16M4.5 17 3 8l5 4 4-7 4 7 5-4-1.5 9",
    round: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
    sigterm: "M13 2.5 5 13.5h6l-1 8 8-11h-6z",
    liveness: "M12 20 4.5 12.5a4.5 4.5 0 0 1 7.5-5 4.5 4.5 0 0 1 7.5 5zM12 7.5l-1.5 4h3l-1.5 4",
    restart: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4",
    join: "M6 21V4.5h9V21M15 4.5l3 1.5V21M11.5 12.5h1",
    ghost: "M6 20.5V10a6 6 0 0 1 12 0v10.5l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5zM10 10h.01M14 10h.01",
    freeze: "M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9",
    crit: "M12 3l2.4 6.1 6.1.4-4.7 3.9 1.5 6.1L12 16.2l-5.3 3.3 1.5-6.1-4.7-3.9 6.1-.4z",
    self: "M12 12h.01M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0",
  };
  const MINOR = new Set(["self", "crit"]); // coups ordinaires : en petit, les grands moments ressortent
  const EMOJI_PREFIX = /^[\p{Extended_Pictographic}‍️\s]+/u;
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  const SVG_NS = "http://www.w3.org/2000/svg";

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function icon(type) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "ev-icon");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICONS[type] || ICONS.self);
    svg.append(path);
    return svg;
  }

  const plural = (n, word) => n + " " + word + (n > 1 ? "s" : "");

  // --- Les loges ---------------------------------------------------------------
  function createLoge(pod) {
    const loge = el("li", "loge");
    loge.dataset.pod = pod;
    const niche = el("div", "loge-niche");
    const cv = el("canvas", "loge-portrait");
    cv.setAttribute("aria-hidden", "true");
    niche.append(cv, el("span", "loge-tag"));
    const hp = el("div", "loge-hp");
    const bar = el("span", "hp-bar");
    bar.append(el("span", "hp-fill"));
    hp.append(bar, el("span", "hp-num"));
    loge.append(niche, el("div", "loge-name"), el("div", "loge-class"), hp, el("div", "loge-meta"), el("div", "loge-pod"));
    return loge;
  }

  function updateLoge(loge, f, winnerPod) {
    const winner = f.pod === winnerPod;
    loge.className = "loge " + f.status + (winner ? " winner" : "");
    loge.querySelector(".loge-name").textContent = f.name;
    loge.querySelector(".loge-class").textContent = f.label;

    const tag = loge.querySelector(".loge-tag");
    tag.textContent = winner ? "Vainqueur" : f.status === "dead" ? "Au tapis" : f.status === "spectator" ? "Attend son tour" : "";

    const ratio = Math.max(0, f.hp) / Math.max(1, f.max_hp);
    const fill = loge.querySelector(".hp-fill");
    fill.style.transform = "scaleX(" + ratio.toFixed(3) + ")";
    fill.dataset.level = ratio > 0.6 ? "high" : ratio > 0.3 ? "mid" : "low";
    loge.querySelector(".hp-num").textContent = f.hp + " / " + f.max_hp + " PV";

    const meta = [];
    if (f.kills > 0) meta.push(plural(f.kills, "élimination"));
    if (f.restarts > 0) meta.push(plural(f.restarts, "redémarrage"));
    loge.querySelector(".loge-meta").textContent = meta.join(", ");

    // Le nom du pod relie le gladiateur à Kubernetes : suffixe visible, nom complet au survol
    const pod = loge.querySelector(".loge-pod");
    pod.textContent = "pod " + f.pod.split("-").pop();
    pod.title = f.pod;

    const look = f.class + "|" + f.status;
    if (loge.dataset.look !== look && window.ArenaScene) {
      loge.dataset.look = look;
      window.ArenaScene.portrait(loge.querySelector(".loge-portrait"), f);
    }

    const prev = lastHp.get(f.pod);
    if (prev !== undefined && f.hp < prev) {
      loge.classList.remove("hit");
      void loge.offsetWidth; // relance l'animation
      loge.classList.add("hit");
    }
    lastHp.set(f.pod, f.hp);
  }

  function renderLoges(s) {
    const existing = new Map();
    grid.querySelectorAll(".loge").forEach((c) => existing.set(c.dataset.pod, c));
    const winnerPod = s.winner ? s.winner.pod : null;
    s.fighters.forEach((f, i) => {
      const loge = existing.get(f.pod) || createLoge(f.pod);
      existing.delete(f.pod);
      updateLoge(loge, f, winnerPod);
      // ordre : vivants d'abord, par PV décroissants (trié côté serveur)
      if (grid.children[i] !== loge) grid.insertBefore(loge, grid.children[i] || null);
    });
    existing.forEach((loge, pod) => {
      loge.remove();
      lastHp.delete(pod);
    });
    emptyMsg.hidden = s.fighters.length > 0;
  }

  // --- Le crieur et le mur de gloire ---------------------------------------------
  function eventItem(e) {
    const li = el("li", "ev ev-" + e.type + (MINOR.has(e.type) ? " minor" : ""));
    li.append(icon(e.type), el("span", "ev-text", e.text.replace(EMOJI_PREFIX, "")));
    return li;
  }

  function gloryItem(h, i) {
    // "Thierry le Ronchon (Archer)" → nom et classe séparés, pour ne jamais tronquer le nom
    const m = /^(.*) \((.*)\)$/.exec(h.name);
    const li = el("li", i < 3 ? "podium" : "");
    const who = el("span", "hof-who");
    who.append(el("span", "hof-name", m ? m[1] : h.name));
    if (m) who.append(el("span", "hof-class", m[2]));
    li.append(el("span", "hof-rank", ROMAN[i] || String(i + 1)), who, el("b", "hof-wins", plural(h.wins, "victoire")));
    return li;
  }

  function renderList(id, items, build) {
    const frag = document.createDocumentFragment();
    items.forEach((it, i) => frag.append(build(it, i)));
    document.getElementById(id).replaceChildren(frag);
  }

  let lastEventsKey = "", lastHofKey = "";

  function render(s, withScene) {
    // La scène d'abord : un souci dans le DOM ci-dessous ne doit pas figer l'animation
    if (withScene && window.ArenaScene) window.ArenaScene.update(s);

    document.getElementById("round").textContent = s.round;
    const badge = document.getElementById("badge");
    badge.className = "phase phase-" + s.state;
    badge.textContent = PHASES[s.state] || s.state;
    document.getElementById("alive").textContent = s.alive;
    document.getElementById("present").textContent = s.present;

    renderLoges(s);

    const eventsKey = s.events.length ? s.events[0].ts + s.events[0].text : "";
    if (eventsKey !== lastEventsKey) {
      lastEventsKey = eventsKey;
      renderList("events", s.events, eventItem);
    }
    const hofKey = JSON.stringify(s.halloffame);
    if (hofKey !== lastHofKey) {
      lastHofKey = hofKey;
      renderList("hof", s.halloffame, gloryItem);
    }

    const victory = document.getElementById("victory");
    victory.classList.toggle("show", s.state === "victory");
    if (s.state === "victory") {
      document.getElementById("victory-name").textContent = s.winner ? s.winner.name : "Double KO";
      document.getElementById("victory-sub").textContent = s.winner
        ? "remporte le round " + s.round + " avec " + plural(s.winner.kills, "élimination")
        : "personne ne gagne ce round";
    }
  }

  async function tick() {
    // Onglet caché : pas de requêtes (la scène, elle, est déjà suspendue par requestAnimationFrame)
    if (document.hidden) return setTimeout(tick, 700);
    try {
      const resp = await fetch("/api/state", { cache: "no-store" });
      if (resp.ok) render(await resp.json(), true);
    } catch (e) {
      // Arène momentanément injoignable : on réessaie au prochain tour.
      // Une erreur de rendu, elle, doit se voir dans la console au lieu de tout figer en silence.
      if (!(e instanceof TypeError && /fetch/i.test(e.message))) console.error(e);
    } finally {
      setTimeout(tick, 700);
    }
  }

  // Le HTML du serveur sert au premier affichage (et sans JavaScript). On le remplace tout de
  // suite par la version complète (portraits, marqueurs), à partir du même état initial.
  // La scène a déjà lu cet état de son côté.
  grid.replaceChildren();
  try {
    render(JSON.parse(document.getElementById("initial-state").textContent), false);
  } catch (e) {
    console.error(e);
  }
  // Les portraits ne dépendent pas des polices, mais la largeur des loges si : on redessine une fois chargées
  if (document.fonts) document.fonts.ready.then(() => grid.querySelectorAll(".loge").forEach((l) => delete l.dataset.look));
  setTimeout(tick, 700);
})();
