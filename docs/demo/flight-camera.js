// Flight camera: zoom levels Ship › Room › Crew member with smooth glides.
//
// The camera moves the whole cutaway (.viewport) with one CSS transform, so
// rooms, crew and art stay aligned. It never changes mission state: room and
// crew clicks still open the same inspector and digital twin as before.
// At ship level it also keeps the ship clear of the HUD: when a fixed panel
// would cover the hull, the ship is fitted into the free space beside it.
function bindFlightCamera({stage, viewport, ship, zones, rooms, roomButtons, pawns, names, crumbs, blockers, top, panels = () => [], sound}) {
  const SHIP_W = 1100, SHIP_H = 475, GAP = 14;
  const roomName = new Map(rooms.map(room => [room.room_id, room.name]));
  let current = {x:0, y:0, s:1};
  let view = {level:"ship", room:null, crew:null};
  let moving = null;
  let enabled = true;
  const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const narrow = () => document.documentElement.clientWidth <= 760;

  // Spotlight: dims and softens everything outside the focused room.
  const dim = document.createElement("div");
  dim.className = "cam-dim";
  dim.setAttribute("aria-hidden", "true");
  ship.querySelector("#hull")?.after(dim);

  const back = document.createElement("button");
  back.type = "button";
  back.className = "cam-back";
  back.textContent = "‹ Back";
  back.title = "Zoom out (Esc)";
  back.addEventListener("click", () => zoomOut());

  function cabinVisible() {
    if (stage.hidden || !ship.offsetWidth || ship.closest("[hidden]")) return false;
    if (stage.hasAttribute("data-timed-demo")) return false;
    return !["return", "entry", "landed"].includes(stage.dataset.vehicle);
  }

  // Untransformed (layout) client box of a ship-space rectangle.
  // The live transform, including mid-glide values, so measuring never drifts.
  function live() {
    const value = getComputedStyle(viewport).transform;
    if (!value || value === "none") return {x:0, y:0, s:1};
    const m = new DOMMatrixReadOnly(value);
    return {x:m.e, y:m.f, s:m.a || 1};
  }
  function shipBox(x = 0, y = 0, w = SHIP_W, h = SHIP_H) {
    const now = live();
    const vp = viewport.getBoundingClientRect();
    const box = ship.getBoundingClientRect();
    const originX = vp.left - now.x, originY = vp.top - now.y;
    const left = originX + (box.left - vp.left) / now.s;
    const topY = originY + (box.top - vp.top) / now.s;
    const width = box.width / now.s, height = box.height / now.s;
    return {
      left:left + x / SHIP_W * width, top:topY + y / SHIP_H * height,
      width:w / SHIP_W * width, height:h / SHIP_H * height, originX, originY,
    };
  }

  // The largest free rectangle for the ship below the HUD and beside corner panels.
  function safeRegion(withPanels = false) {
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    const topLimit = Math.max(0, ...top().map(node => node.getBoundingClientRect().bottom)) + GAP;
    const nodes = [...blockers(), ...(withPanels ? panels() : [])];
    const boxes = nodes.map(node => node.getBoundingClientRect()).filter(box => box.width && box.bottom > topLimit);
    const full = {left:GAP, top:topLimit, right:width - GAP, bottom:height - GAP};
    const above = {...full, bottom:Math.min(full.bottom, ...boxes.map(box => box.top - GAP))};
    const beside = {...full,
      left:Math.max(full.left, ...boxes.filter(box => box.left + box.width / 2 < width / 2).map(box => box.right + GAP)),
      right:Math.min(full.right, ...boxes.filter(box => box.left + box.width / 2 >= width / 2).map(box => box.left - GAP))};
    return {options:[above, beside].map(r => ({...r, width:r.right - r.left, height:r.bottom - r.top}))
      .filter(r => r.width > 120 && r.height > 80), boxes, topLimit};
  }

  function fit(box, region, maxScale) {
    const s = Math.min(maxScale, region.width / box.width, region.height / box.height);
    return {
      s,
      x:region.left + (region.width - s * box.width) / 2 - box.originX - s * (box.left - box.originX),
      y:region.top + (region.height - s * box.height) / 2 - box.originY - s * (box.top - box.originY),
    };
  }

  function best(box, options, maxScale) {
    let pick = null;
    for (const region of options) {
      const target = fit(box, region, maxScale);
      if (!pick || target.s > pick.s) pick = target;
    }
    return pick;
  }

  const overlaps = (a, b) => a.left < b.right && a.left + a.width > b.left && a.top < b.bottom && a.top + a.height > b.top;

  function shipTarget() {
    if (narrow() || !cabinVisible()) return {x:0, y:0, s:1};
    const box = shipBox();
    const {options, boxes, topLimit} = safeRegion();
    const covered = box.top < topLimit - GAP || boxes.some(other => overlaps(box, other));
    if (!covered || !options.length) return {x:0, y:0, s:1};
    return best(box, options, 1) ?? {x:0, y:0, s:1};
  }

  function roomTarget(roomId) {
    const z = zones[roomId];
    const pad = 10;
    const box = shipBox(z.x - pad, z.y - pad, z.w + pad * 2, z.h + pad * 2);
    const {options} = safeRegion(true);
    const regions = options.map(r => ({...r, left:r.left + 24, top:r.top + 8, width:r.width - 48, height:r.height - 32}));
    return best(box, regions, 2.4) ?? {x:0, y:0, s:1};
  }

  function apply(target, animate) {
    const smooth = animate && !reduced();
    viewport.classList.toggle("cam-smooth", Boolean(smooth));
    viewport.classList.toggle("cam-fade", Boolean(animate && reduced()));
    current = target;
    const identity = Math.abs(target.s - 1) < .001 && Math.abs(target.x) < .5 && Math.abs(target.y) < .5;
    viewport.style.transform = identity ? "" : `translate(${target.x.toFixed(1)}px,${target.y.toFixed(1)}px) scale(${target.s.toFixed(4)})`;
    if (!animate) return;
    document.body.dataset.camMoving = "";
    clearTimeout(moving);
    moving = setTimeout(() => {
      delete document.body.dataset.camMoving;
      viewport.classList.remove("cam-smooth", "cam-fade");
      settle();
    }, smooth ? 820 : 220);
  }

  function spotlight() {
    const z = view.level === "ship" ? null : zones[view.room];
    if (view.level === "ship") delete ship.dataset.camRoom;
    else ship.dataset.camRoom = view.room;
    for (const [id, button] of roomButtons) {
      if (id === view.room && view.level !== "ship") button.dataset.camTarget = "";
      else delete button.dataset.camTarget;
    }
    if (!z) { dim.style.removeProperty("clip-path"); return; }
    const l = z.x / SHIP_W * 100, t = z.y / SHIP_H * 100;
    const r = (z.x + z.w) / SHIP_W * 100, b = (z.y + z.h) / SHIP_H * 100;
    dim.style.clipPath = `polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,${l}% ${t}%,${l}% ${b}%,${r}% ${b}%,${r}% ${t}%,${l}% ${t}%)`;
  }

  function crumb(label, action) {
    if (!action) {
      const item = document.createElement("span");
      item.textContent = label;
      item.setAttribute("aria-current", "location");
      return item;
    }
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = label;
    item.addEventListener("click", action);
    return item;
  }

  function drawCrumbs() {
    const parts = [];
    const atShip = view.level === "ship";
    parts.push(crumb("Ship", atShip ? null : () => go({level:"ship"})));
    if (!atShip) parts.push(crumb(roomName.get(view.room) ?? view.room,
      view.level === "crew" ? () => go({level:"room", room:view.room}) : null));
    if (view.level === "crew") parts.push(crumb(names[view.crew] ?? "Crew member", null));
    const nodes = [];
    parts.forEach((part, i) => {
      if (i) {
        const sep = document.createElement("i");
        sep.textContent = "›";
        sep.setAttribute("aria-hidden", "true");
        nodes.push(sep);
      }
      nodes.push(part);
    });
    if (!atShip) nodes.push(back);
    crumbs.replaceChildren(...nodes);
    // Shown only once the camera is inside: the top bar already names the ship.
    crumbs.hidden = atShip || !cabinVisible();
    stage.dataset.camLevel = view.level;
  }

  function go(next, {animate = true, silent = false} = {}) {
    if (!enabled) return;
    const deeper = rank(next.level) > rank(view.level);
    const changed = next.level !== view.level || next.room !== view.room || next.crew !== view.crew;
    view = {level:next.level, room:next.room ?? null, crew:next.crew ?? null};
    const target = view.level === "ship" ? shipTarget() : roomTarget(view.room);
    if (animate && changed && !silent) sound?.play(deeper ? "zoom-in" : "zoom-out");
    apply(target, animate && changed);
    spotlight();
    drawCrumbs();
  }
  const rank = level => ({ship:0, room:1, crew:2})[level];

  function zoomOut() {
    if (view.level === "crew") go({level:"room", room:view.room});
    else if (view.level === "room") go({level:"ship"});
  }

  function roomOfPawn(index) {
    const pawn = pawns.get(index);
    if (!pawn) return null;
    const box = shipBox();
    const rect = pawn.getBoundingClientRect();
    const now = live();
    const cx = ((rect.left + rect.width / 2 - box.originX - now.x) / now.s + box.originX - box.left) / box.width * SHIP_W;
    const cy = ((rect.top + rect.height / 2 - box.originY - now.y) / now.s + box.originY - box.top) / box.height * SHIP_H;
    let pick = null, distance = Infinity;
    for (const [id, z] of Object.entries(zones)) {
      if (!roomName.has(id)) continue;
      const dx = Math.max(z.x - cx, 0, cx - z.x - z.w), dy = Math.max(z.y - cy, 0, cy - z.y - z.h);
      const d = Math.hypot(dx, dy);
      if (d < distance) { distance = d; pick = id; }
    }
    return pick;
  }

  // Existing clicks keep their behaviour; the camera only follows them.
  for (const [id, button] of roomButtons) {
    button.addEventListener("click", () => {
      if (!enabled || narrow() || !cabinVisible()) return;
      go({level:"room", room:id});
    });
  }
  for (const [index, pawn] of pawns) {
    pawn.addEventListener("click", () => {
      if (!enabled || narrow() || !cabinVisible()) return;
      const room = roomOfPawn(index);
      if (room) go({level:"crew", room, crew:index});
    });
  }

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || view.level === "ship" || event.defaultPrevented) return;
    if (document.querySelector("dialog[open]")) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input,textarea,select,.hud-menu[data-open]")) return;
    zoomOut();
  });

  // Re-fit on layout changes without animating; reset when the cabin view goes away.
  let pending = 0;
  function refresh() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      // Mid-glide: the glide's own end triggers the next refresh.
      if (document.body.hasAttribute("data-cam-moving")) return;
      if (!cabinVisible() && view.level !== "ship") view = {level:"ship", room:null, crew:null};
      const target = view.level === "ship" ? shipTarget() : roomTarget(view.room);
      if (Math.abs(target.s - current.s) > .002 || Math.abs(target.x - current.x) > 1 || Math.abs(target.y - current.y) > 1) {
        // Inside a room, make room for a panel with a glide; at ship level, follow silently.
        apply(target, view.level !== "ship");
      }
      spotlight();
      drawCrumbs();
    });
  }
  const watch = new ResizeObserver(refresh);
  for (const node of [...top(), ...blockers()]) watch.observe(node);
  // Padding on the cutaway changes with the HUD, so watch border boxes too.
  for (const node of [viewport, ship, viewport.parentElement]) watch.observe(node, {box:"border-box"});
  // A panel that opened during the glide may need a short second glide.
  function settle() {
    if (!cabinVisible()) return;
    const target = view.level === "ship" ? shipTarget() : roomTarget(view.room);
    const far = Math.abs(target.s - current.s) > .01 || Math.abs(target.x - current.x) > 6 || Math.abs(target.y - current.y) > 6;
    if (far) apply(target, true);
  }
  window.addEventListener("resize", refresh);
  new MutationObserver(refresh).observe(stage, {attributes:true, attributeFilter:["hidden", "data-vehicle", "data-timed-demo"]});
  // Opening or closing a panel while zoomed re-frames the room beside it.
  new MutationObserver(() => { if (view.level !== "ship") refresh(); })
    .observe(viewport.parentElement, {attributes:true, subtree:true, attributeFilter:["hidden"]});
  const panelWatch = new MutationObserver(refresh);
  for (const node of blockers()) panelWatch.observe(node, {attributes:true, attributeFilter:["hidden", "style", "class"]});

  // Establishing shot: the first time the cabin appears, glide in from space.
  let introduced = false;
  new MutationObserver(() => {
    if (introduced || stage.hidden || !cabinVisible() || narrow() || reduced()) return;
    introduced = true;
    requestAnimationFrame(() => {
      const target = shipTarget();
      const box = shipBox();
      const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
      const s = target.s * .62;
      // Same on-screen centre, smaller ship: the camera starts further out in space.
      apply({s,
        x:target.x + (target.s - s) * (cx - box.originX),
        y:target.y + (target.s - s) * (cy - box.originY)}, false);
      requestAnimationFrame(() => requestAnimationFrame(() => { sound?.play("zoom-in"); apply(target, true); }));
    });
  }).observe(stage, {attributes:true, attributeFilter:["hidden"]});

  refresh();
  return {
    focusRoom:id => go({level:"room", room:id}),
    focusCrew:index => { const room = roomOfPawn(index); if (room) go({level:"crew", room, crew:index}); },
    zoomOut, reset:() => go({level:"ship"}),
    refresh,
    get level() { return view.level; },
    setEnabled(value) { enabled = value; if (!value) { view = {level:"ship", room:null, crew:null}; apply({x:0, y:0, s:1}, false); spotlight(); drawCrumbs(); } },
  };
}
