// Pod Royale — rafraîchit l'arène toutes les 700 ms.
// fetch('/api/state') vise la même origine que la page : aucun besoin de CORS.
(function () {
  "use strict";

  const grid = document.getElementById("grid");
  const lastHp = new Map();

  // PV initiaux rendus par le serveur
  grid.querySelectorAll(".card").forEach((card) => {
    const hp = parseInt(card.querySelector(".hp").textContent, 10);
    lastHp.set(card.dataset.pod, hp);
    colorBar(card.querySelector(".hpfill"), parseFloat(card.querySelector(".hpfill").style.width) / 100);
  });

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function colorBar(fill, ratio) {
    fill.classList.toggle("mid", ratio <= 0.6 && ratio > 0.3);
    fill.classList.toggle("low", ratio <= 0.3);
  }

  function createCard(pod) {
    const card = el("article", "card");
    card.dataset.pod = pod;
    const head = el("div", "card-head");
    head.append(el("span", "emoji"));
    const who = el("div", "who");
    who.append(el("div", "name"), el("div", "pod"));
    head.append(who);
    const bar = el("div", "hpbar");
    bar.append(el("div", "hpfill"));
    const meta = el("div", "meta");
    meta.append(el("span", "hp"), el("span", "kills"), el("span", "restarts"));
    card.append(head, bar, meta, el("div", "node"), el("div", "overlay"));
    return card;
  }

  function updateCard(card, f, winnerPod) {
    card.className = "card " + f.status + (f.pod === winnerPod ? " winner" : "");
    const emoji = card.querySelector(".emoji");
    emoji.textContent = f.emoji;
    emoji.title = f.label;
    card.querySelector(".name").textContent = f.name;
    card.querySelector(".pod").textContent = f.pod;
    const ratio = Math.max(0, f.hp) / Math.max(1, f.max_hp);
    const fill = card.querySelector(".hpfill");
    fill.style.width = (100 * ratio).toFixed(1) + "%";
    colorBar(fill, ratio);
    card.querySelector(".hp").textContent = f.hp + " / " + f.max_hp + " PV";
    card.querySelector(".kills").textContent = "☠️ × " + f.kills;
    const restarts = card.querySelector(".restarts");
    restarts.textContent = f.restarts > 0 ? "↻ " + f.restarts : "";
    card.querySelector(".node").textContent = "node: " + f.node;

    const prev = lastHp.get(f.pod);
    if (prev !== undefined && f.hp < prev) {
      card.classList.remove("shake");
      void card.offsetWidth; // relance l'animation
      card.classList.add("shake");
    }
    lastHp.set(f.pod, f.hp);
  }

  function renderGrid(s) {
    const existing = new Map();
    grid.querySelectorAll(".card").forEach((c) => existing.set(c.dataset.pod, c));
    const empty = grid.querySelector(".empty");
    if (empty && s.fighters.length) empty.remove();

    const winnerPod = s.winner ? s.winner.pod : null;
    s.fighters.forEach((f, i) => {
      let card = existing.get(f.pod);
      if (!card) card = createCard(f.pod);
      existing.delete(f.pod);
      updateCard(card, f, winnerPod);
      // ordre : vivants d'abord, par PV décroissants (trié côté serveur)
      if (grid.children[i] !== card) grid.insertBefore(card, grid.children[i] || null);
    });
    existing.forEach((card, pod) => {
      card.remove();
      lastHp.delete(pod);
    });
    if (!s.fighters.length && !grid.querySelector(".empty")) {
      grid.append(el("p", "empty", "Aucun guerrier dans l'arène…"));
    }
  }

  function renderList(id, items, build) {
    const list = document.getElementById(id);
    const frag = document.createDocumentFragment();
    items.forEach((it) => frag.append(build(it)));
    list.replaceChildren(frag);
  }

  let lastEventsKey = "";

  function render(s) {
    document.getElementById("round").textContent = s.round;
    const badge = document.getElementById("badge");
    badge.className = "badge badge-" + s.state;
    badge.textContent = s.state.toUpperCase();
    document.getElementById("alive").textContent = s.alive;
    document.getElementById("present").textContent = s.present;

    renderGrid(s);

    const eventsKey = s.events.length ? s.events[0].ts + s.events[0].text : "";
    if (eventsKey !== lastEventsKey) {
      lastEventsKey = eventsKey;
      renderList("events", s.events, (e) => el("li", "ev-" + e.type, e.text));
    }
    renderList("hof", s.halloffame, (h) => {
      const li = el("li");
      li.append(el("span", null, h.name), el("b", null, h.wins + " 🏆"));
      return li;
    });

    const victory = document.getElementById("victory");
    victory.classList.toggle("show", s.state === "victory");
    if (s.state === "victory") {
      document.getElementById("victory-name").textContent =
        s.winner ? s.winner.emoji + " " + s.winner.name : "Double KO";
      document.getElementById("victory-sub").textContent = s.winner
        ? "remporte le round " + s.round + " avec " + s.winner.kills + " élimination(s)"
        : "personne ne gagne";
    }
  }

  async function tick() {
    try {
      const resp = await fetch("/api/state", { cache: "no-store" });
      if (resp.ok) render(await resp.json());
    } catch (e) {
      // arène momentanément injoignable : on réessaie au prochain tour
    } finally {
      setTimeout(tick, 700);
    }
  }

  // le premier rendu vient du serveur (Jinja2), on enchaîne ensuite les rafraîchissements
  setTimeout(tick, 700);
})();
