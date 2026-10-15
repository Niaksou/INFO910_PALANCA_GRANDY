// Pod Royale — la scène : de petits gladiateurs dessinés au canvas qui rejouent
// les vrais coups échangés entre pods (liste pr:hits renvoyée par /api/state).
(function () {
  "use strict";

  const canvas = document.getElementById("scene");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --- Apparence des classes ------------------------------------------------
  // Angles du bras (radians, personnage tourné vers la droite) : 0 = devant, -π/2 = en l'air
  const STYLES = {
    barbare: { body: "#8a4b2a", trim: "#4e2a15", skin: "#e8b48a", weapon: "axe", head: "horns", idle: -0.7 },
    mage: { body: "#4b3c9e", trim: "#2a2163", skin: "#f0c9a0", weapon: "staff", head: "wizard", idle: -1.1, ranged: "fireball" },
    archer: { body: "#3f7a3a", trim: "#24481f", skin: "#e9bf94", weapon: "bow", head: "hood", idle: 0.7, ranged: "arrow" },
    paladin: { body: "#c7ccd6", trim: "#7d8699", skin: "#f2cfa8", weapon: "sword", head: "helm", idle: -0.6 },
    gobelin: { body: "#6b4b2b", trim: "#3a2815", skin: "#7fbf4a", weapon: "dagger", head: "ears", idle: 0.3 },
    sysadmin: { body: "#2b2f3a", trim: "#14171e", skin: "#e6b991", weapon: "keyboard", head: "headset", idle: -0.5 },
  };
  const OUTLINE = "#1a120c";
  const styleOf = (f) => STYLES[f.class] || STYLES.barbare;

  // --- État de la scène -----------------------------------------------------
  let W = 0, H = 0, dpr = 1, S = 1, bg = null;
  const actors = new Map();
  const projectiles = [], particles = [], texts = [], bolts = [];
  let state = null, seenHits = null, lastRound = null;
  let time = 0, shake = 0, confettiAcc = 0;
  const fx = [];             // effets d'impact : ondes de choc, entailles, rayons
  let slowmo = 0, whiteFlash = 0;
  let paused = false;        // barre d'espace : fige la scène (pratique pour expliquer à l'oral)

  const geo = () => ({ cx: W / 2, cy: H * 0.62, rx: W * 0.36, ry: H * 0.22 });
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  const easeIn = (t) => t * t;

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shape(fill, stroke, width) {
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width || 1.5; ctx.stroke(); }
  }

  // --- Décor (pré-rendu à chaque redimensionnement) -------------------------
  function seeded(seed) {
    return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  }

  function renderBackground() {
    const off = document.createElement("canvas");
    off.width = W * dpr; off.height = H * dpr;
    const c = off.getContext("2d");
    c.scale(dpr, dpr);
    const rnd = seeded(42);
    const { cx, cy } = geo();
    const frx = W * 0.47, fry = H * 0.36;

    let g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1c130d"); g.addColorStop(1, "#0d0b0a");
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    // Gradins et public
    const top = cy - fry;
    for (let row = 0; row < 4; row++) {
      const y = row * (top / 4);
      c.fillStyle = row % 2 ? "#241911" : "#2b1e14";
      c.fillRect(0, y, W, top / 4 + 1);
      c.fillStyle = "rgba(0,0,0,0.35)";
      c.fillRect(0, y + top / 4 - 3, W, 3);
      for (let x = 6; x < W; x += 9 + rnd() * 6) {
        if (rnd() < 0.25) continue;
        const hue = [20, 30, 0, 200, 45, 280][Math.floor(rnd() * 6)];
        c.fillStyle = `hsla(${hue}, 30%, ${18 + rnd() * 14}%, 0.9)`;
        c.beginPath();
        c.arc(x, y + top / 4 - 9 - rnd() * 3, 3.2, 0, Math.PI * 2);
        c.fill();
        c.fillRect(x - 4, y + top / 4 - 6, 8, 4);
      }
    }

    // Sol de sable
    c.save();
    c.beginPath(); c.ellipse(cx, cy, frx, fry, 0, 0, Math.PI * 2); c.clip();
    g = c.createRadialGradient(cx, cy - fry * 0.2, 10, cx, cy, frx);
    g.addColorStop(0, "#d9b77c"); g.addColorStop(0.6, "#b08a55"); g.addColorStop(1, "#6e5030");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      c.fillStyle = rnd() < 0.5 ? "rgba(90,60,30,0.18)" : "rgba(255,240,200,0.12)";
      c.fillRect(cx + (rnd() - 0.5) * 2 * frx, cy + (rnd() - 0.5) * 2 * fry, 2, 1.5);
    }
    // Barre de gouvernail Kubernetes tracée dans le sable
    c.translate(cx, cy);
    c.scale(1, fry / frx);
    const R = Math.min(frx, fry * 2.2) * 0.32;
    c.strokeStyle = "rgba(95,62,30,0.28)";
    c.lineWidth = 7;
    c.beginPath();
    for (let i = 0; i <= 7; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 7;
      c[i ? "lineTo" : "moveTo"](Math.cos(a) * R, Math.sin(a) * R);
    }
    c.stroke();
    c.lineWidth = 4;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 7;
      c.beginPath(); c.moveTo(Math.cos(a) * R * 0.22, Math.sin(a) * R * 0.22);
      c.lineTo(Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85); c.stroke();
    }
    c.beginPath(); c.arc(0, 0, R * 0.2, 0, Math.PI * 2); c.stroke();
    c.restore();

    // Muret de l'arène
    c.lineWidth = 10; c.strokeStyle = "#3a2a1b";
    c.beginPath(); c.ellipse(cx, cy, frx, fry, 0, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 2; c.strokeStyle = "#5a4128";
    c.beginPath(); c.ellipse(cx, cy, frx - 5, fry - 5, 0, 0, Math.PI * 2); c.stroke();
    return off;
  }

  function drawTorch(x, y) {
    ctx.fillStyle = "#2a1d12"; ctx.fillRect(x - 3, y - 6, 6, 40);
    ctx.fillStyle = "#4a3320"; ctx.fillRect(x - 8, y - 10, 16, 6);
    const f = 1 + Math.sin(time * 17 + x) * 0.08 + Math.sin(time * 29 + x) * 0.06;
    const glow = ctx.createRadialGradient(x, y - 18, 2, x, y - 18, 70);
    glow.addColorStop(0, "rgba(255,170,60,0.28)"); glow.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = glow; ctx.fillRect(x - 70, y - 90, 140, 140);
    ctx.fillStyle = "#ff7a1a";
    ctx.beginPath(); ctx.ellipse(x, y - 20 * f, 8, 15 * f, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffd25a";
    ctx.beginPath(); ctx.ellipse(x, y - 16 * f, 4.5, 9 * f, 0, 0, Math.PI * 2); ctx.fill();
  }

  // --- Dessin d'un personnage -----------------------------------------------
  function drawWeapon(st, a) {
    switch (st.weapon) {
      case "axe":
        ctx.fillStyle = "#7a4a24"; ctx.fillRect(-1.5, 6, 3, 27);
        ctx.beginPath(); ctx.moveTo(1.5, 23); ctx.lineTo(12, 18); ctx.lineTo(13.5, 33); ctx.lineTo(1.5, 30); ctx.closePath();
        shape("#a7adb5", OUTLINE, 1.2);
        ctx.strokeStyle = "#eef3f8"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(12, 19.5); ctx.lineTo(13, 31.5); ctx.stroke();
        break;
      case "sword":
        ctx.fillStyle = "#6b4423"; ctx.fillRect(-1.5, 9, 3, 6);
        ctx.fillStyle = "#e8b64c"; ctx.fillRect(-5, 14.5, 10, 2.5);
        ctx.beginPath(); ctx.moveTo(-2, 17); ctx.lineTo(2, 17); ctx.lineTo(2, 36); ctx.lineTo(0, 40); ctx.lineTo(-2, 36); ctx.closePath();
        shape("#e3e8ee", "#6d7480", 1);
        break;
      case "dagger":
        ctx.fillStyle = "#e8b64c"; ctx.fillRect(-3.5, 14, 7, 2);
        ctx.beginPath(); ctx.moveTo(-1.6, 16); ctx.lineTo(1.6, 16); ctx.lineTo(1.6, 25); ctx.lineTo(0, 29); ctx.lineTo(-1.6, 25); ctx.closePath();
        shape("#d7dde4", "#6d7480", 1);
        break;
      case "staff": {
        ctx.fillStyle = "#6b4423"; ctx.fillRect(-1.5, -8, 3, 41);
        const pulse = 5 + Math.sin(time * 6) * 0.8;
        ctx.save();
        ctx.shadowColor = "#ff9a3c"; ctx.shadowBlur = 12;
        const g = ctx.createRadialGradient(0, 36, 1, 0, 36, pulse);
        g.addColorStop(0, "#fff1b8"); g.addColorStop(0.5, "#ffb347"); g.addColorStop(1, "#e2531c");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 36, pulse, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case "bow": {
        const pull = a.pull || 0;
        ctx.strokeStyle = "#8a5a2b"; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(-14, 8); ctx.quadraticCurveTo(0, 30, 14, 8); ctx.stroke();
        ctx.strokeStyle = "#efe6d2"; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(-14, 8); ctx.lineTo(0, 13 - pull * 9); ctx.lineTo(14, 8); ctx.stroke();
        if (pull > 0.05) {
          ctx.strokeStyle = "#7a4a24"; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(0, 13 - pull * 9); ctx.lineTo(0, 30); ctx.stroke();
          ctx.fillStyle = "#c9ced6";
          ctx.beginPath(); ctx.moveTo(-2.5, 29); ctx.lineTo(2.5, 29); ctx.lineTo(0, 34); ctx.closePath(); ctx.fill();
        }
        break;
      }
      case "keyboard":
        rr(-4.5, 9, 9, 28, 2); shape("#20232b", "#5a6070", 1);
        for (let i = 0; i < 7; i++) {
          for (let j = 0; j < 2; j++) {
            ctx.fillStyle = `hsl(${(time * 120 + i * 40 + j * 20) % 360}, 80%, 65%)`;
            ctx.fillRect(-3 + j * 3.5, 11 + i * 3.6, 2.4, 2.4);
          }
        }
        break;
    }
  }

  function drawHeadBack(st) {
    if (st.head === "hood") {
      ctx.beginPath(); ctx.arc(1, -44, 15, 0, Math.PI * 2); shape(st.body, OUTLINE);
      ctx.beginPath(); ctx.moveTo(-10, -50); ctx.lineTo(-22, -34); ctx.lineTo(-9, -38); ctx.closePath(); shape(st.body, OUTLINE);
    } else if (st.head === "ears") {
      ctx.beginPath(); ctx.moveTo(-6, -48); ctx.lineTo(-25, -55); ctx.lineTo(-8, -39); ctx.closePath(); shape(st.skin, OUTLINE);
    }
  }

  function drawFace(st, dead, phase) {
    if (st.head === "helm") return;
    if (dead) {
      ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.4;
      [[5, -46], [10, -46]].forEach(([x, y]) => {
        ctx.beginPath(); ctx.moveTo(x - 1.8, y - 1.8); ctx.lineTo(x + 1.8, y + 1.8);
        ctx.moveTo(x + 1.8, y - 1.8); ctx.lineTo(x - 1.8, y + 1.8); ctx.stroke();
      });
      return;
    }
    const blink = Math.sin(time * 1.3 + phase) > 0.985;
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(4, blink ? -45 : -48, 2.2, blink ? 1 : 4);
    ctx.fillRect(9, blink ? -45 : -48, 2.2, blink ? 1 : 4);
    if (st.head === "ears") {
      ctx.beginPath(); ctx.arc(13, -42, 3, 0, Math.PI * 2); shape(st.skin, OUTLINE, 1);
      ctx.fillStyle = "#fff"; ctx.fillRect(6, -38, 2, 2); ctx.fillRect(9, -38, 2, 2);
    } else {
      ctx.fillStyle = "rgba(120,50,40,0.8)"; ctx.fillRect(6, -38.5, 5, 1.4);
    }
  }

  function drawHeadFront(st) {
    switch (st.head) {
      case "horns":
        ctx.beginPath(); ctx.moveTo(-4, -38); ctx.lineTo(13, -38); ctx.lineTo(5, -29); ctx.closePath(); shape("#6b3a1e", OUTLINE, 1);
        ctx.beginPath(); ctx.arc(1, -46, 12.8, Math.PI, 2 * Math.PI); shape("#8d939b", OUTLINE);
        ctx.fillStyle = "#6f757d"; ctx.fillRect(-12, -47.5, 26, 3);
        ctx.beginPath(); ctx.moveTo(-8, -54); ctx.quadraticCurveTo(-20, -58, -17, -70); ctx.quadraticCurveTo(-12, -60, -3, -57); ctx.closePath(); shape("#efe6d2", OUTLINE, 1);
        ctx.beginPath(); ctx.moveTo(10, -54); ctx.quadraticCurveTo(22, -58, 19, -70); ctx.quadraticCurveTo(14, -60, 5, -57); ctx.closePath(); shape("#efe6d2", OUTLINE, 1);
        break;
      case "wizard":
        ctx.beginPath(); ctx.moveTo(-3, -38); ctx.lineTo(13, -38); ctx.lineTo(4, -26); ctx.closePath(); shape("#e9e4da", OUTLINE, 1);
        ctx.beginPath(); ctx.ellipse(1, -53, 17, 4.5, 0, 0, Math.PI * 2); shape(st.trim, OUTLINE);
        ctx.beginPath(); ctx.moveTo(-11, -54); ctx.lineTo(13, -54); ctx.quadraticCurveTo(2, -66, -10, -82); ctx.closePath(); shape(st.body, OUTLINE);
        ctx.fillStyle = "#ffd84a"; ctx.font = "9px sans-serif"; ctx.fillText("★", -2, -60);
        break;
      case "hood":
        ctx.beginPath(); ctx.arc(1, -44, 12.5, Math.PI + 0.35, -0.05); ctx.lineTo(1, -50); ctx.closePath(); shape(st.body);
        break;
      case "helm":
        ctx.beginPath(); ctx.arc(1, -44, 12.8, 0, Math.PI * 2); shape("#b9c0cc", OUTLINE);
        ctx.fillStyle = "#2a2f38"; ctx.fillRect(3, -47, 11, 3);
        ctx.fillStyle = "#8a93a6"; ctx.fillRect(0, -56, 2, 22);
        ctx.beginPath(); ctx.moveTo(-1, -56); ctx.quadraticCurveTo(-12, -68, -22, -58); ctx.quadraticCurveTo(-12, -62, -2, -52); ctx.closePath(); shape("#c0392b", OUTLINE, 1);
        break;
      case "ears":
        ctx.fillStyle = "#3a2815"; ctx.fillRect(-6, -57, 3, 4); ctx.fillRect(-1, -58, 3, 5);
        break;
      case "headset":
        ctx.beginPath(); ctx.arc(1, -45, 12.8, Math.PI, 2 * Math.PI); shape("#2a1d14", OUTLINE);
        ctx.strokeStyle = "#111"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(1, -44, 15, Math.PI + 0.4, -0.4); ctx.stroke();
        rr(-13, -48, 6, 9, 2); shape("#111");
        ctx.strokeStyle = "#111"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-8, -40); ctx.quadraticCurveTo(0, -33, 9, -36); ctx.stroke();
        ctx.strokeStyle = "#d8dde6"; ctx.lineWidth = 1.2;
        ctx.strokeRect(2.5, -49.5, 5, 4.5); ctx.strokeRect(8.5, -49.5, 5, 4.5);
        break;
    }
  }

  function drawBody(a, st, armAngle, walk) {
    const dead = a.deadT !== null;
    // Jambes
    ctx.fillStyle = st.trim;
    ctx.fillRect(-7, -15 + Math.max(0, walk), 5, 15 - Math.max(0, walk));
    ctx.fillRect(2, -15 + Math.max(0, -walk), 5, 15 - Math.max(0, -walk));
    // Carquois de l'archer
    if (st.weapon === "bow") {
      ctx.save(); ctx.translate(-9, -32); ctx.rotate(-0.35);
      rr(-3, 0, 6, 18, 2); shape("#6b4423", OUTLINE, 1);
      ctx.fillStyle = "#e8e0cc"; ctx.fillRect(-2.5, -4, 1.5, 4); ctx.fillRect(1, -5, 1.5, 5);
      ctx.restore();
    }
    // Torse
    rr(-10, -33, 20, 21, 5); shape(st.body, OUTLINE);
    ctx.fillStyle = st.trim; ctx.fillRect(-10, -18, 20, 3);
    if (st.head === "helm") { ctx.fillStyle = "#e8b64c"; ctx.fillRect(-1, -30, 3, 10); ctx.fillRect(-4.5, -27, 10, 3); }
    if (st.weapon === "keyboard") {
      ctx.strokeStyle = "#326ce5"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(1, -25, 4, 0, Math.PI * 2); ctx.stroke();
    }
    // Bouclier du paladin
    if (st.head === "helm") {
      rr(-17, -35, 13, 19, 4); shape("#2f5fb0", OUTLINE);
      ctx.fillStyle = "#e8b64c"; ctx.fillRect(-11.5, -32, 2, 13); ctx.fillRect(-15, -27, 9, 2);
    }
    // Tête
    drawHeadBack(st);
    ctx.beginPath(); ctx.arc(1, -44, 12, 0, Math.PI * 2); shape(st.skin, OUTLINE);
    drawFace(st, dead, a.phase);
    drawHeadFront(st);
    // Bras armé
    ctx.save();
    ctx.translate(2, -29);
    ctx.rotate(armAngle - Math.PI / 2);
    rr(-3, -1, 6, 13, 3); shape(st.body, OUTLINE, 1.2);
    drawWeapon(st, a);
    ctx.beginPath(); ctx.arc(0, 13, 3.3, 0, Math.PI * 2); shape(st.skin, OUTLINE, 1);
    ctx.restore();
  }

  function drawCrown(x, y) {
    ctx.beginPath();
    ctx.moveTo(x - 10, y); ctx.lineTo(x - 10, y - 9); ctx.lineTo(x - 5, y - 4); ctx.lineTo(x, y - 12);
    ctx.lineTo(x + 5, y - 4); ctx.lineTo(x + 10, y - 9); ctx.lineTo(x + 10, y); ctx.closePath();
    shape("#ffd24a", OUTLINE, 1.2);
  }

  function fitText(text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
    return text + "…";
  }

  function drawActor(a) {
    const st = styleOf(a.f);
    const s = S * (a.spectator ? 0.62 : 1);
    const dead = a.deadT !== null;
    const winner = isWinner(a);

    ctx.save();
    ctx.globalAlpha = a.alpha * (a.spectator ? 0.7 : 1);
    ctx.translate(a.x + a.kx, a.y);

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(0, 0, 15 * s, 4.5 * s, 0, 0, Math.PI * 2); ctx.fill();

    // Aura dorée pendant la préparation d'un coup critique
    if (a.anim && a.anim.crit && !a.anim.done) {
      const pulse = 1 + Math.sin(time * 30) * 0.12;
      const g = ctx.createRadialGradient(0, -34 * s, 4, 0, -34 * s, 46 * s * pulse);
      g.addColorStop(0, "rgba(255,230,120,0.75)");
      g.addColorStop(0.5, "rgba(255,190,60,0.35)");
      g.addColorStop(1, "rgba(255,160,40,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, -34 * s, 46 * s * pulse, 0, Math.PI * 2); ctx.fill();
    }

    // Pose
    let arm = st.idle, lift = 0, walk = 0, tilt = a.tilt || 0;
    const moving = Math.hypot(a.vx, a.vy) > 25;
    if (!dead && !a.spectator) lift = Math.sin(time * 4 + a.phase) * 1.2;
    if (moving && !dead) walk = Math.sin(time * 16) * 3;
    if (a.armOverride !== null) arm = a.armOverride;
    if (winner && !dead) {
      lift = Math.abs(Math.sin(time * 6)) * 14;
      arm = -1.9 + Math.sin(time * 6) * 0.4;
    }

    ctx.save();
    ctx.scale(a.facing * s, s);
    if (dead) {
      ctx.rotate(-easeOut(Math.min(1, a.deadT)) * Math.PI / 2);
      ctx.filter = "grayscale(1) brightness(0.75)";
    } else if (a.flash > 0.45) {
      ctx.filter = "brightness(2.4) saturate(0.4)";
    }
    ctx.rotate(tilt);
    ctx.translate(0, -lift);
    drawBody(a, st, arm, walk);
    ctx.filter = "none";
    ctx.restore();

    // Étiquettes (non retournées)
    ctx.textAlign = "center";
    if (!a.spectator && !dead) {
      const bw = 40, by = -92 * s - (winner ? lift * s : 0);
      const ratio = clamp(a.barHp / Math.max(1, a.maxHp), 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(-bw / 2 - 1, by - 1, bw + 2, 7);
      ctx.fillStyle = ratio > 0.6 ? "#4fbf5a" : ratio > 0.3 ? "#e8913a" : "#d63a2f";
      ctx.fillRect(-bw / 2, by, bw * ratio, 5);
      ctx.font = "bold 10px ui-monospace, Menlo, monospace";
      ctx.textAlign = "left";
      let ix = bw / 2 + 4;
      if (a.f.kills > 0) { ctx.fillStyle = "#e8b64c"; ctx.fillText("☠" + a.f.kills, ix, by + 6); ix += 22; }
      if (a.f.restarts > 0) { ctx.fillStyle = "#9fc3ff"; ctx.fillText("↻" + a.f.restarts, ix, by + 6); }
      ctx.textAlign = "center";
      if (winner) drawCrown(0, by - 6);
    } else if (a.spectator) {
      ctx.font = `${Math.round(12 * s)}px sans-serif`;
      ctx.fillText("⏳", 14 * s, -70 * s);
    }

    const nameSize = a.spectator ? 9 : 11;
    ctx.font = `bold ${nameSize}px system-ui, sans-serif`;
    const name = fitText(a.f.name, a.spectator ? 80 : 120);
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10,6,3,0.85)";
    ctx.strokeText(name, 0, 15 * s + 2);
    ctx.fillStyle = winner ? "#ffd24a" : "#f1e6d4";
    ctx.fillText(name, 0, 15 * s + 2);
    if (!a.spectator) {
      ctx.font = "9px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "rgba(240,225,200,0.6)";
      ctx.fillText(fitText(a.pod, 120), 0, 15 * s + 14);
    }
    ctx.restore();
  }

  // --- Effets ---------------------------------------------------------------
  function sparks(x, y, n, colors) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 140;
      particles.push({ kind: "spark", x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 60,
        life: 0.4 + Math.random() * 0.3, t: 0, color: colors[i % colors.length], size: 2 + Math.random() * 2 });
    }
  }

  function poof(x, y) {
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2;
      particles.push({ kind: "smoke", x, y: y - 20, vx: Math.cos(ang) * 40, vy: Math.sin(ang) * 25 - 10,
        life: 0.7, t: 0, size: 6 + Math.random() * 6 });
    }
  }

  function floatText(x, y, text, color, size, pop) {
    texts.push({ x, y, text, color, size, pop: !!pop, t: 0, life: pop ? 1.5 : 1.1 });
  }

  const KEYS = ["Ctrl", "Alt", "Suppr", "sudo", "rm -rf", "^C", ":wq", "F5", "Échap"];

  // Effet d'impact propre à l'arme de l'attaquant, amplifié en cas de coup critique
  function impactFx(att, tgt, h) {
    const x = tgt.x, y = tgt.y - 30 * S, c = h.c, k = c ? 1.7 : 1;
    const dir = att && att !== tgt ? Math.sign(tgt.x - att.x) || 1 : 1;
    const weapon = att && h.a !== h.t ? styleOf(att.f).weapon : null;
    switch (weapon) {
      case "axe":
        fx.push({ kind: "ring", x, y: tgt.y, r1: 48 * k * S, flat: 0.4, color: "120,80,40", width: 5, t: 0, life: 0.45 });
        fx.push({ kind: "slash", x, y, dir, size: 30 * k * S, rot: 1.2, color: c ? "#ffe27a" : "#f4efe6", t: 0, life: 0.28 });
        for (let i = 0; i < 10 * k; i++) {
          particles.push({ kind: "smoke", x: x + (Math.random() - 0.5) * 30, y: tgt.y + 18, vx: (Math.random() - 0.5) * 80,
            vy: -20 - Math.random() * 30, life: 0.5, t: 0, size: 3 + Math.random() * 4 });
        }
        break;
      case "sword":
        fx.push({ kind: "slash", x, y, dir, size: 34 * k * S, rot: -0.5, color: c ? "#ffe27a" : "#ffffff", t: 0, life: 0.3 });
        break;
      case "dagger":
        fx.push({ kind: "slash", x, y, dir, size: 20 * k * S, rot: -0.9, color: c ? "#ffe27a" : "#e6ffd9", t: 0, life: 0.22 });
        fx.push({ kind: "slash", x, y, dir, size: 20 * k * S, rot: 0.9, color: c ? "#ffe27a" : "#e6ffd9", t: -0.08, life: 0.22 });
        break;
      case "keyboard":
        for (let i = 0; i < (c ? 9 : 4); i++) {
          const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
          particles.push({ kind: "letter", text: KEYS[Math.floor(Math.random() * KEYS.length)], x, y,
            vx: Math.cos(ang) * (90 + Math.random() * 80), vy: Math.sin(ang) * (110 + Math.random() * 80),
            life: 0.9, t: 0, color: `hsl(${Math.random() * 360}, 85%, 70%)` });
        }
        fx.push({ kind: "slash", x, y, dir, size: 26 * k * S, rot: 0.3, color: "#9fd0ff", t: 0, life: 0.25 });
        break;
      case "staff":
        fx.push({ kind: "ring", x, y, r1: 40 * k * S, flat: 1, color: "255,140,40", width: 7, t: 0, life: 0.4 });
        for (let i = 0; i < 16 * k; i++) {
          const ang = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 120 * k;
          particles.push({ kind: "ember", x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0.5, t: 0, size: 3 + Math.random() * 4 });
        }
        break;
      case "bow":
        sparks(x, y, c ? 10 : 5, ["#8a5a2b", "#e8e0cc"]);
        fx.push({ kind: "ring", x, y, r1: 22 * k * S, flat: 1, color: c ? "255,215,90" : "255,255,255", width: 3, t: 0, life: 0.25 });
        break;
    }
    if (c) {
      // Coup critique : onde dorée, rayons, flash blanc, ralenti et tremblement
      fx.push({ kind: "ring", x, y, r1: 95 * S, flat: 1, color: "255,215,90", width: 6, t: 0, life: 0.55 });
      fx.push({ kind: "burst", x, y, t: 0, life: 0.45, rot: Math.random() * 6 });
      if (!reduceMotion) { slowmo = 0.3; whiteFlash = 1; shake = Math.max(shake, 0.35); }
    }
  }

  function lightning(a) {
    const pts = [];
    let x = a.x + (Math.random() - 0.5) * 40;
    for (let y = -10; y < a.y - 30; y += 18) {
      pts.push([x, y]);
      x += (Math.random() - 0.5) * 26;
    }
    pts.push([a.x, a.y - 30]);
    bolts.push({ pts, t: 0, life: 0.45 });
    sparks(a.x, a.y - 30, 14, ["#e8f4ff", "#9fc3ff", "#fff59a"]);
    if (!reduceMotion) shake = 0.3;
  }

  // --- Coups -----------------------------------------------------------------
  const hitKey = (h) => h.ts + "|" + h.a + "|" + h.t;

  function release(h) {
    const t = actors.get(h.t);
    if (t && t.pendingIn > 0) t.pendingIn--;
  }

  function impact(h) {
    release(h);
    const tgt = actors.get(h.t);
    if (!tgt || tgt.leaving !== null) return;
    const att = actors.get(h.a);
    tgt.dispHp = Math.max(0, tgt.dispHp - h.d);
    tgt.flash = 1;
    if (att && att !== tgt) tgt.kx = Math.sign(tgt.x - att.x || 1) * 10;
    const head = tgt.y - 70 * S;
    impactFx(att, tgt, h);
    if (h.c) {
      floatText(tgt.x, head - 22, "CRITIQUE !", "#ffd24a", 24, true);
      floatText(tgt.x, head + 4, `-${h.d}`, "#ffffff", 22, true);
      sparks(tgt.x, tgt.y - 30 * S, 22, ["#fff59a", "#ffb347", "#ffffff"]);
    } else {
      floatText(tgt.x, head, h.a === h.t ? `aïe ! -${h.d}` : `-${h.d}`, h.a === h.t ? "#c9b8ff" : "#ff7a6b", 13);
      sparks(tgt.x, tgt.y - 30 * S, 7, ["#ffffff", "#ffcf8a"]);
    }
    if (h.k) {
      tgt.dispHp = 0;
      die(tgt);
      floatText(tgt.x, head - 18, "K.O.", "#ff4d3d", 20);
      particles.push({ kind: "ghost", x: tgt.x, y: tgt.y - 40, vx: 0, vy: -28, life: 1.8, t: 0 });
    }
  }

  function die(a) {
    if (a.deadT === null) a.deadT = 0;
  }

  function queueAttack(h) {
    if (!state || h.r !== state.round) return release(h);
    const att = actors.get(h.a), tgt = actors.get(h.t);
    if (!tgt) return;
    // Attaquant inconnu, déjà parti ou trop de retard : on applique le coup directement
    if (!att || att.leaving !== null || att.spectator || att.queue.length >= 2) return impact(h);
    att.queue.push(h);
  }

  function handleHits(hits, first) {
    const keys = new Set(hits.map(hitKey));
    if (first || seenHits === null) { seenHits = keys; return; }
    const fresh = hits.filter((h) => !seenHits.has(hitKey(h))).sort((x, y) => x.ts - y.ts);
    seenHits = keys;
    if (!fresh.length) return;
    // On rejoue les coups avec leur vrai décalage temporel (borné), pour lisser l'animation
    const base = fresh[0].ts;
    fresh.forEach((h) => {
      const t = actors.get(h.t);
      if (t) { t.pendingIn++; t.pendingAt = time; }
      setTimeout(() => queueAttack(h), Math.min(900, (h.ts - base) * 1000));
    });
  }

  function startAnim(a) {
    const h = a.queue.shift();
    const st = styleOf(a.f);
    const type = h.a === h.t ? "trip" : st.ranged ? "shoot" : "melee";
    const crit = !!h.c && type !== "trip";
    // Un critique se prépare plus longtemps : on voit le personnage se charger
    const dur = { melee: 0.55, shoot: 0.55, trip: 0.6 }[type] * (a.queue.length ? 0.65 : 1) * (crit ? 1.5 : 1);
    a.anim = { type, h, p: 0, dur, sx: a.x, sy: a.y, done: false, crit };
  }

  function updateAnim(a, dt) {
    const an = a.anim;
    an.p = Math.min(1, an.p + dt / an.dur);
    const p = an.p;
    const st = styleOf(a.f);
    const tgt = actors.get(an.h.t);

    if (an.type === "trip") {
      a.tilt = Math.sin(p * Math.PI * 3) * 0.45 * (1 - p);
      if (p > 0.3 && !an.done) { an.done = true; impact(an.h); }
    } else if (an.type === "melee") {
      if (!tgt) { a.anim = null; release(an.h); return; }
      const dir = Math.sign(tgt.x - an.sx) || 1;
      a.facing = dir;
      const ax = tgt.x - dir * 30 * S, ay = tgt.y + 2;
      if (p < 0.35) {
        const k = easeOut(p / 0.35);
        a.x = lerp(an.sx, ax, k); a.y = lerp(an.sy, ay, k);
        a.armOverride = lerp(st.idle, -2.4, k);
      } else if (p < 0.6) {
        a.x = ax; a.y = ay;
        a.armOverride = lerp(-2.4, 0.6, easeIn(clamp((p - 0.35) / 0.12, 0, 1)));
        if (p > 0.45 && !an.done) { an.done = true; impact(an.h); }
      } else {
        const k = easeOut((p - 0.6) / 0.4);
        a.x = lerp(ax, a.hx, k); a.y = lerp(ay, a.hy, k);
        a.armOverride = lerp(0.6, st.idle, k);
      }
    } else {
      if (!tgt) { a.anim = null; release(an.h); return; }
      a.facing = Math.sign(tgt.x - a.x) || a.facing;
      const aim = st.weapon === "bow" ? -0.15 : -1.5;
      if (p < 0.35) {
        a.armOverride = lerp(st.idle, aim, easeOut(p / 0.35));
        a.pull = p / 0.35;
      } else {
        if (!an.done) {
          an.done = true;
          a.pull = 0;
          const sx = a.x + a.facing * 22 * S, sy = a.y - 34 * S;
          projectiles.push({ kind: st.ranged, h: an.h, crit: an.h.c, x0: sx, y0: sy, t: 0, dur: an.h.c ? 0.26 : 0.32 });
        }
        a.armOverride = lerp(st.weapon === "bow" ? aim : -0.3, st.idle, easeOut((p - 0.35) / 0.65));
      }
    }
    if (p >= 1) {
      if (!an.done) impact(an.h);
      a.anim = null; a.armOverride = null; a.tilt = 0; a.pull = 0;
    }
  }

  // --- Synchronisation avec /api/state ---------------------------------------
  function isWinner(a) {
    return state && state.state === "victory" && state.winner && state.winner.pod === a.pod;
  }

  function makeActor(f) {
    return {
      pod: f.pod, f, x: 0, y: 0, hx: 0, hy: 0, vx: 0, vy: 0, facing: 1, phase: Math.random() * 6.28,
      dispHp: f.hp, barHp: f.hp, maxHp: f.max_hp, deadT: f.status === "dead" ? 1 : null,
      anim: null, queue: [], armOverride: null, tilt: 0, pull: 0, flash: 0, kx: 0,
      pendingIn: 0, pendingAt: 0, alpha: 1, leaving: null, spectator: f.status === "spectator", placed: false,
    };
  }

  function layout() {
    if (!state) return;
    const { cx, cy, rx, ry } = geo();
    const byPod = (x, y) => (x.pod < y.pod ? -1 : 1);
    const fighters = state.fighters.filter((f) => f.status !== "spectator").sort(byPod);
    const specs = state.fighters.filter((f) => f.status === "spectator").sort(byPod);
    fighters.forEach((f, i) => {
      const a = actors.get(f.pod);
      if (!a) return;
      const ang = Math.PI + (2 * Math.PI * i) / Math.max(1, fighters.length);
      a.spectator = false;
      if (isWinner(a)) { a.hx = cx; a.hy = cy; return; }
      a.hx = cx + rx * Math.cos(ang);
      a.hy = cy + ry * Math.sin(ang);
    });
    specs.forEach((f, i) => {
      const a = actors.get(f.pod);
      if (!a) return;
      a.spectator = true;
      a.hx = W * 0.08 + ((W * 0.84) * (i + 0.5)) / specs.length;
      a.hy = H * 0.2;
    });
    actors.forEach((a) => {
      if (!a.placed) { a.x = a.hx; a.y = a.hy; a.placed = true; }
    });
  }

  function update(s) {
    const first = state === null;
    state = s;
    const roundChanged = lastRound !== null && s.round !== lastRound;
    lastRound = s.round;

    const present = new Set();
    s.fighters.forEach((f) => {
      present.add(f.pod);
      let a = actors.get(f.pod);
      if (!a) {
        a = makeActor(f);
        actors.set(f.pod, a);
        if (!first) {
          // Nouveau pod : il entre par la porte du bas
          a.x = W / 2; a.y = H + 30; a.placed = true;
          poof(W / 2, H - 10);
        }
      }
      if (a.leaving !== null) { a.leaving = null; a.alpha = 1; }
      a.f = f;
      a.maxHp = f.max_hp;
    });
    actors.forEach((a, pod) => {
      if (!present.has(pod) && a.leaving === null) { a.leaving = time; lightning(a); }
    });
    layout();

    if (roundChanged) {
      actors.forEach((a) => {
        a.dispHp = a.f.hp; a.deadT = null; a.pendingIn = 0; a.queue = [];
        a.anim = null; a.armOverride = null; a.tilt = 0;
      });
      if (s.state === "fighting") floatText(W / 2, H * 0.45, `ROUND ${s.round} — FIGHT !`, "#ffd24a", 30);
    }

    handleHits(s.hits || [], first);

    actors.forEach((a) => {
      if (a.leaving !== null) return;
      if (a.pendingIn > 0 && time - a.pendingAt > 3) a.pendingIn = 0;
      if (a.pendingIn === 0) {
        a.dispHp = a.f.hp;
        if (a.f.status === "dead") die(a);
        else if (a.deadT !== null) a.deadT = null;
      }
    });
  }

  // --- Boucle d'animation ------------------------------------------------------
  function step(dt) {
    time += dt;
    shake = Math.max(0, shake - dt);

    actors.forEach((a, pod) => {
      if (a.leaving !== null) {
        a.alpha = Math.max(0, 1 - (time - a.leaving) / 0.6);
        if (a.alpha <= 0) actors.delete(pod);
        return;
      }
      if (!a.anim && a.queue.length) {
        // Un mort ne frappe plus : ses derniers coups en attente s'appliquent directement
        if (a.deadT !== null) a.queue.splice(0).forEach(impact);
        else startAnim(a);
      }
      const px = a.x, py = a.y;
      if (a.anim && a.anim.crit && !a.anim.done && Math.random() < 0.7) {
        const ang = Math.random() * Math.PI * 2;
        particles.push({ kind: "spark", x: a.x + Math.cos(ang) * 30 * S, y: a.y - 34 * S + Math.sin(ang) * 30 * S,
          vx: -Math.cos(ang) * 60, vy: -Math.sin(ang) * 60 - 40, life: 0.35, t: 0, color: "#ffe27a", size: 2.5 });
      }
      if (a.anim) {
        updateAnim(a, dt);
      } else {
        const k = Math.min(1, dt * 4);
        a.x += (a.hx - a.x) * k; a.y += (a.hy - a.y) * k;
        if (!a.spectator) a.facing = a.hx < W / 2 ? 1 : -1;
        if (isWinner(a)) a.facing = Math.sin(time * 1.5) > 0 ? 1 : -1;
      }
      a.vx = (a.x - px) / Math.max(dt, 1e-3); a.vy = (a.y - py) / Math.max(dt, 1e-3);
      a.kx *= Math.pow(0.002, dt);
      a.flash = Math.max(0, a.flash - dt * 5);
      a.barHp += (a.dispHp - a.barHp) * Math.min(1, dt * 8);
      if (a.deadT !== null && a.deadT < 1) a.deadT = Math.min(1, a.deadT + dt / 0.45);
    });

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const pr = projectiles[i];
      pr.t += dt / pr.dur;
      const tgt = actors.get(pr.h.t);
      if (tgt) { pr.x1 = tgt.x; pr.y1 = tgt.y - 30 * S; }
      if (pr.x1 === undefined || pr.t >= 1) {
        projectiles.splice(i, 1);
        impact(pr.h);
        continue;
      }
      if (pr.kind === "fireball" || pr.crit) {
        const p = posOf(pr);
        // Traînée : braises pour la boule de feu, étincelles dorées pour la flèche critique
        const gold = pr.kind === "arrow";
        for (let n = 0; n < 2; n++) {
          particles.push({ kind: gold ? "spark" : "ember", x: p.x + (Math.random() - 0.5) * 6, y: p.y + (Math.random() - 0.5) * 6,
            vx: (Math.random() - 0.5) * 40, vy: -15 - Math.random() * 25, life: 0.25 + Math.random() * 0.15, t: 0,
            size: (pr.crit ? 3 : 1.5) + Math.random() * 2.5, color: "#ffd24a" });
        }
      }
    }

    if (state && state.state === "victory" && !reduceMotion) {
      confettiAcc += dt * 60;
      while (confettiAcc > 1) {
        confettiAcc -= 1;
        particles.push({ kind: "confetti", x: Math.random() * W, y: -10, vx: (Math.random() - 0.5) * 40,
          vy: 60 + Math.random() * 60, life: 4, t: 0, rot: Math.random() * 6, color: `hsl(${Math.random() * 360}, 85%, 60%)` });
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t >= p.life || p.y > H + 20) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === "spark" || p.kind === "letter") p.vy += 380 * dt;
      if (p.kind === "confetti") p.rot += dt * 6;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      texts[i].t += dt;
      if (texts[i].t >= texts[i].life) texts.splice(i, 1);
    }
    for (let i = fx.length - 1; i >= 0; i--) {
      fx[i].t += dt;
      if (fx[i].t >= fx[i].life) fx.splice(i, 1);
    }
    for (let i = bolts.length - 1; i >= 0; i--) {
      bolts[i].t += dt;
      if (bolts[i].t >= bolts[i].life) bolts.splice(i, 1);
    }
  }

  function posOf(pr) {
    const t = Math.min(1, pr.t);
    const arc = pr.kind === "arrow" ? Math.sin(t * Math.PI) * 26 : Math.sin(t * Math.PI) * 10;
    return { x: lerp(pr.x0, pr.x1, t), y: lerp(pr.y0, pr.y1, t) - arc };
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 8 * shake / 0.3, (Math.random() - 0.5) * 8 * shake / 0.3);
    if (bg) ctx.drawImage(bg, 0, 0, W, H);
    drawTorch(W * 0.045, H * 0.6);
    drawTorch(W * 0.955, H * 0.6);

    const list = [...actors.values()].sort((a, b) => (a.spectator === b.spectator ? a.y - b.y : a.spectator ? -1 : 1));
    list.forEach(drawActor);

    projectiles.forEach((pr) => {
      if (pr.x1 === undefined) return;
      const p = posOf(pr);
      if (pr.kind === "arrow") {
        const q = posOf({ ...pr, t: Math.max(0, pr.t - 0.06) });
        const ang = Math.atan2(p.y - q.y, p.x - q.x);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang);
        if (pr.crit) { ctx.scale(1.6, 1.6); ctx.shadowColor = "#ffd24a"; ctx.shadowBlur = 16; }
        ctx.strokeStyle = pr.crit ? "#ffd24a" : "#7a4a24"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(0, 0); ctx.stroke();
        ctx.fillStyle = "#d7dde4"; ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-2, -3); ctx.lineTo(-2, 3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#e8e0cc"; ctx.fillRect(-20, -2.5, 4, 5);
        ctx.restore();
      } else {
        ctx.save();
        ctx.shadowColor = "#ff8a2a"; ctx.shadowBlur = 18;
        const r = pr.crit ? 16 : 9;
        if (pr.crit) { ctx.shadowColor = "#7ad7ff"; ctx.shadowBlur = 26; }
        const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, r);
        g.addColorStop(0, "#ffffff"); g.addColorStop(0.35, pr.crit ? "#bfe9ff" : "#fff6c8");
        g.addColorStop(0.6, "#ffb347"); g.addColorStop(1, "#e2531c");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    });

    particles.forEach((p) => {
      const k = 1 - p.t / p.life;
      ctx.globalAlpha = Math.max(0, k);
      if (p.kind === "spark") { ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); }
      else if (p.kind === "ember") {
        ctx.fillStyle = k > 0.5 ? "#ffd25a" : "#ff6a1a";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * k, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === "smoke") {
        ctx.fillStyle = "rgba(200,190,175,0.6)";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.5 - k), 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === "ghost") {
        ctx.font = "22px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("👻", p.x + Math.sin(p.t * 5) * 6, p.y);
      } else if (p.kind === "letter") {
        ctx.font = "bold 12px ui-monospace, Menlo, monospace"; ctx.textAlign = "center";
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10,6,3,0.9)"; ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
      } else if (p.kind === "confetti") {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.fillRect(-3, -1.5, 6, 3); ctx.restore();
      }
    });
    ctx.globalAlpha = 1;

    fx.forEach((e) => {
      if (e.t < 0) return;
      const k = e.t / e.life;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      if (e.kind === "ring") {
        const r = 6 + easeOut(k) * e.r1;
        ctx.strokeStyle = `rgba(${e.color},1)`; ctx.lineWidth = e.width * (1 - k) + 1;
        ctx.beginPath(); ctx.ellipse(e.x, e.y, r, r * e.flat, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (e.kind === "slash") {
        // Entaille en croissant qui balaie la cible
        ctx.translate(e.x, e.y); ctx.scale(e.dir, 1); ctx.rotate(e.rot);
        const sweep = Math.min(1, k * 3);
        const a0 = -1.3, a1 = a0 + 2.6 * sweep;
        ctx.shadowColor = e.color; ctx.shadowBlur = 12;
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.arc(0, 0, e.size, a0, a1);
        ctx.arc(e.size * 0.3, 0, e.size * 0.8, a1, a0, true);
        ctx.closePath(); ctx.fill();
      } else if (e.kind === "burst") {
        ctx.translate(e.x, e.y); ctx.rotate(e.rot + k * 0.6);
        ctx.fillStyle = "#fff3b0";
        for (let i = 0; i < 12; i++) {
          ctx.rotate((Math.PI * 2) / 12);
          ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(3, 0); ctx.lineTo(0, -(20 + easeOut(k) * 70) * S); ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();
    });

    bolts.forEach((b) => {
      const k = 1 - b.t / b.life;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.fillStyle = "rgba(200,225,255,0.25)"; ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.shadowColor = "#9fc3ff"; ctx.shadowBlur = 16;
      ctx.strokeStyle = "#f4f9ff"; ctx.lineWidth = 3;
      ctx.beginPath(); b.pts.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](x, y)); ctx.stroke();
      ctx.restore();
    });

    texts.forEach((t) => {
      const k = t.t / t.life;
      ctx.globalAlpha = 1 - easeIn(k);
      ctx.font = `900 ${t.size}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      const y = t.y - easeOut(k) * 30;
      // Les textes « pop » (critiques) apparaissent en grand puis se posent
      const sc = t.pop ? 1 + Math.max(0, 1 - k * 6) * 1.2 : 1;
      ctx.save(); ctx.translate(t.x, y); ctx.scale(sc, sc);
      if (t.pop) { ctx.shadowColor = t.color; ctx.shadowBlur = 14; }
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(10,6,3,0.9)";
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color; ctx.fillText(t.text, 0, 0);
      ctx.restore();
    });
    ctx.globalAlpha = 1;

    if (whiteFlash > 0) {
      ctx.fillStyle = `rgba(255,250,230,${whiteFlash * 0.35})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }

    if (state && state.present < 2) {
      ctx.font = "600 15px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = "rgba(241,230,212,0.85)";
      ctx.fillText("En attente de combattants…", W / 2, H * 0.6);
      ctx.font = "12px ui-monospace, Menlo, monospace"; ctx.fillStyle = "#e8b64c";
      ctx.fillText("kubectl -n pod-royale scale deploy/guerrier --replicas=6", W / 2, H * 0.6 + 22);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!paused) {
      whiteFlash = Math.max(0, whiteFlash - dt * 4);
      // Ralenti bref après un coup critique
      if (slowmo > 0) slowmo -= dt;
      step(slowmo > 0 ? dt * 0.3 : dt);
      draw();
    }
    requestAnimationFrame(frame);
  }

  function resize() {
    const w = canvas.parentElement.clientWidth;
    if (!w) return;
    const h = Math.round(clamp(w * 0.56, 340, 560));
    dpr = window.devicePixelRatio || 1;
    W = w; H = h;
    S = clamp(h / 480, 0.75, 1.15);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + "px";
    bg = renderBackground();
    actors.forEach((a) => { a.placed = false; });
    layout();
  }

  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas.parentElement);
  else window.addEventListener("resize", resize);
  resize();

  const initial = document.getElementById("initial-state");
  if (initial) {
    try { update(JSON.parse(initial.textContent)); } catch (e) { /* le premier fetch prendra le relais */ }
  }
  requestAnimationFrame(frame);

  function setPaused(value) {
    paused = value;
    if (paused) {
      draw();
      ctx.fillStyle = "rgba(10,6,3,0.55)"; ctx.fillRect(W / 2 - 70, 14, 140, 32);
      ctx.font = "800 16px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = "#ffd24a"; ctx.fillText("⏸ PAUSE", W / 2, 36);
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.target !== document.body) return;
    e.preventDefault();
    setPaused(!paused);
  });

  window.ArenaScene = { update, actors, setPaused };
})();
