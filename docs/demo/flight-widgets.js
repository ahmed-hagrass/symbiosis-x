// Single owner for canvas panel placement and lifecycle. Parked panels retain
// their contents and can be recalled without stacking on the active panels.
function createFlightWidgets(overlay, shelf, notice, fixedControls = []) {
  const gap = 10;
  const stage = overlay.closest(".stage");
  const entries = [];
  const overlaps = (a, b) => a.x < b.x+b.w+gap && a.x+a.w+gap > b.x
    && a.y < b.y+b.h+gap && a.y+a.h+gap > b.y;
  const clamp = (value, max) => Math.max(0, Math.min(value, max));
  const rect = (node, bounds) => {
    const box = node.getBoundingClientRect();
    return {x:box.left-bounds.left,y:box.top-bounds.top,w:box.width,h:box.height};
  };
  let focused = null;
  const ribbonPopupIds = new Set(["show-inspector", "show-crew", "show-workflow"]);
  const isRibbonPopup = entry => Boolean(entry.toggle && ribbonPopupIds.has(entry.toggle.id));
  // Position menu popups in viewport coordinates, directly below their ribbon
  // triggers. The flight overlay has a 100px top clearance, so ordinary
  // overlay-relative positioning makes a "dropdown" appear far away.
  const placeRibbonPopup = (entry, occupied, overlayBounds) => {
    // A trigger inside a top-bar menu anchors to that menu's word instead.
    const anchor = entry.toggle.closest(".hud-menu")?.querySelector(".hud-menu-trigger") ?? entry.toggle;
    const trigger = anchor.getBoundingClientRect();
    const panel = entry.panel;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    panel.style.position = "fixed";
    panel.style.maxWidth = "calc(100vw - 20px)";
    if (entry.toggle.id !== "show-crew" || stage.hasAttribute("data-timed-demo")) {
      const dock = document.getElementById("crew-strip").getBoundingClientRect();
      const panelWidth = panel.offsetWidth;
      let x = Math.max(gap,Math.min(trigger.left,viewportWidth-panelWidth-gap));
      let y = trigger.bottom + 8;
      panel.style.maxHeight = Math.max(140,viewportHeight-y-20)+"px";
      if (x < dock.right+8 && x+panelWidth > dock.left-8 && y < dock.bottom+8 && y+panel.offsetHeight > dock.top-8) {
        const xLeft = dock.left-panelWidth-12;
        if (xLeft >= gap) x = Math.min(x,xLeft);
        else y = Math.min(viewportHeight-140,dock.bottom+12);
      }
      // Never open underneath the mission resources box.
      const resources = document.getElementById("mission-resources")?.getBoundingClientRect();
      if (resources?.width && x < resources.right+8 && x+panelWidth > resources.left-8 && y < resources.bottom+8)
        y = Math.min(viewportHeight-140,resources.bottom+10);
      // Stop above a corner box (Mission Overview, Orbit Map) in the same column.
      let floor = viewportHeight-12;
      for (const id of ["map-widget","orbit-map-widget"]) {
        const corner = document.getElementById(id);
        const box = corner && !corner.hidden ? corner.getBoundingClientRect() : null;
        if (box?.width && x < box.right+8 && x+panelWidth > box.left-8 && box.top > y+140) floor = Math.min(floor,box.top-10);
      }
      panel.style.maxHeight = Math.max(100,floor-y)+"px";
      Object.assign(panel.style,{left:x+"px",top:y+"px"});
      entry.position = null;
      return true;
    }
    const top = trigger.bottom + gap;
    const width = viewportWidth - 2*gap;
    const height = viewportHeight - top - gap;
    const preferred = {x:trigger.left-gap,y:0};
    const obstacles = occupied.map(box=>({...box,x:box.x+overlayBounds.left-gap,y:box.y+overlayBounds.top-top}));
    const result = fitPanel(panel,preferred,obstacles,width,height,true);
    entry.position = null;
    if (result) Object.assign(panel.style,{left:(result.x+gap)+"px",top:(result.y+top)+"px"});
    return Boolean(result);
  };
  const dismissRibbon = () => {
    let changed = false;
    for (const entry of entries) {
      if (!isRibbonPopup(entry) || !entry.wanted || entry.panel.hidden) continue;
      entry.wanted = false;
      entry.panel.hidden = true;
      changed = true;
    }
    if (changed) { focused = null; layout(); }
  };
  document.addEventListener("keydown",event=>{
    if (event.key === "Escape") dismissRibbon();
  });
  document.addEventListener("pointerdown",event=>{
    if (event.target.closest(".ribbon,#widget-shelf,#crew-strip,#flight-playback") || entries.some(entry=>entry.panel.contains(event.target))) return;
    dismissRibbon();
  });

  function reserveControls(occupied, bounds) {
    for (const control of fixedControls) {
      if (stage.hasAttribute("data-timed-demo") && control.closest(".hud")) continue;
      if (!control.hidden && control.offsetWidth && control.offsetHeight) occupied.push(rect(control,bounds));
    }
  }

  function findPlacement(w, h, preferred, occupied, width, height) {
    if (!w || !h || w > width || h > height) return null;
    const xs = [preferred.x, gap, width-w-gap, ...occupied.flatMap(r=>[r.x+r.w+gap,r.x-w-gap])];
    const ys = [preferred.y, gap, height-h-gap, ...occupied.flatMap(r=>[r.y+r.h+gap,r.y-h-gap])];
    const points = xs.flatMap(x=>ys.map(y=>({x:clamp(x,width-w),y:clamp(y,height-h),w,h})));
    points.sort((a,b)=>Math.hypot(a.x-preferred.x,a.y-preferred.y)-Math.hypot(b.x-preferred.x,b.y-preferred.y));
    return points.find(p=>!occupied.some(r=>overlaps(p,r)));
  }

  function fitPanel(panel, preferred, occupied, width, height, compact) {
    panel.style.maxHeight = "";
    let result = findPlacement(panel.offsetWidth,panel.offsetHeight,preferred,occupied,width,height);
    if (result || !compact) return result;

    // Use the full-size panel when it fits, then shrink it to run alongside
    // another panel or fit in the remaining space on a small screen.
    const originalHeight = Math.min(panel.offsetHeight,height);
    for (const fraction of [1,.85,.7,.55,.4,.35,.3,.25]) {
      const cap = Math.floor(originalHeight*fraction);
      if (cap < 90) break;
      panel.style.maxHeight = cap+"px";
      result = findPlacement(panel.offsetWidth,panel.offsetHeight,preferred,occupied,width,height);
      if (result) break;
    }
    return result;
  }

  function place(entry, preferred, occupied, height, compact) {
    const result = fitPanel(entry.panel,preferred,occupied,overlay.clientWidth,height,compact);
    if (!result) return false;
    entry.position = {x:result.x,y:result.y};
    Object.assign(entry.panel.style,{left:result.x+"px",top:result.y+"px"});
    return true;
  }

  function refreshShelf() {
    for (const entry of entries) {
      entry.recall.hidden = !entry.wanted || !entry.panel.hidden;
      entry.toggle?.setAttribute("aria-pressed",String(entry.wanted && !entry.panel.hidden));
    }
    shelf.hidden = entries.every(entry=>entry.recall.hidden);
  }

  function layout() {
    const active = entries.filter(entry=>entry.wanted);
    const pinned = active.filter(entry=>entry.persistent);
    const ribbonPopups = active.filter(isRibbonPopup);
    const prioritizeFocus = focused?.compactPriority && !isRibbonPopup(focused);
    const profileBeforeRoster = prioritizeFocus && overlay.clientWidth < 700 && focused.panel.id === "personnel-widget" &&
      ribbonPopups.some(entry=>entry.toggle.id === "show-crew");
    const ordered = [...(prioritizeFocus ? [focused,...pinned] : [...pinned,focused]),
      ...active.filter(entry=>entry!==focused && !entry.persistent)]
      .filter((entry,index,list)=>entry?.wanted && list.indexOf(entry)===index);
    const bounds = overlay.getBoundingClientRect();
    const timed = stage.hasAttribute("data-timed-demo");
    const height = Math.min(overlay.clientHeight,document.documentElement.clientHeight-bounds.top-gap);
    const occupied = [];
    reserveControls(occupied,bounds);
    // The narrow timed demo deliberately anchors the evidence card onscreen.
    // Reserve it before moving any other widget into the available space.
    const fixedEntries = active.filter(entry=>!isRibbonPopup(entry) && getComputedStyle(entry.panel).position === "fixed");
    for (const entry of fixedEntries) {
      entry.panel.hidden = false;
      occupied.push(rect(entry.panel,bounds));
    }
    const floating = ordered.filter(entry=>!isRibbonPopup(entry) && !fixedEntries.includes(entry));
    const layoutOrder = profileBeforeRoster ? [...floating,...ribbonPopups] : [...ribbonPopups,...floating];
    for (const entry of layoutOrder) {
      const hadFocus = entry.panel.contains(document.activeElement);
      entry.panel.hidden = false;
      const preferred = entry.position ?? entry.preferred();
      const placed = isRibbonPopup(entry) ? placeRibbonPopup(entry,occupied,bounds)
        : place(entry,preferred,occupied,entry.panel.classList.contains("profile-window") && !timed ? height : overlay.clientHeight,
          entry.compactPriority);
      if (placed) occupied.push(rect(entry.panel,bounds));
      else {
        entry.panel.hidden = true;
        if (hadFocus) { entry.recall.hidden = false; shelf.hidden = false; entry.recall.focus(); }
      }
    }
    refreshShelf();
  }

  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(()=>{pending=false;layout();});
  }
  const sizes = new ResizeObserver(entries=>{ if (entries.some(e=>!e.target.hidden)) schedule(); });
  sizes.observe(overlay);
  window.addEventListener("resize",schedule);
  window.addEventListener("scroll",schedule);

  function register(panel, toggle, preferred, {persistent=false,lock=null,compactPriority=false} = {}) {
    const handle = panel.querySelector(".move-widget"), bar = panel.querySelector(".widget-bar");
    if (!panel.hasAttribute("tabindex")) panel.tabIndex = 0;
    const recall = document.createElement("button");
    recall.type = "button";
    recall.textContent = panel.querySelector("h2")?.textContent || "Inspector";
    recall.setAttribute("aria-controls",panel.id);
    recall.hidden = true;
    shelf.append(recall);
    const entry = {panel,toggle,preferred,recall,persistent,compactPriority,wanted:!panel.hidden,position:null,trigger:null};
    let locked = Boolean(lock);
    entries.push(entry);
    sizes.observe(panel);
    toggle?.setAttribute("aria-controls",panel.id);

    function open(trigger) {
      if (isRibbonPopup(entry)) {
        for (const other of entries) {
          if (other === entry || !isRibbonPopup(other)) continue;
          other.wanted = false;
          other.panel.hidden = true;
        }
        entry.position = null;
      }
      entry.wanted = true;
      entry.trigger = trigger ?? toggle ?? entry.trigger;
      focused = entry;
      layout();
      notice.textContent = entry.panel.hidden ? recall.textContent + " is parked. Recall it from Parked widgets." : "";
    }
    function resetPosition() {
      entry.position = null;
    }
    function close() {
      entry.wanted = false;
      entry.panel.hidden = true;
      if (focused===entry) focused=null;
      layout();
      const target = entry.trigger?.closest("[hidden]") ? null : entry.trigger;
      (target ?? toggle ?? document.getElementById("show-inspector"))?.focus();
    }
    function move(x,y) {
      const bounds = overlay.getBoundingClientRect();
      const height = Math.min(overlay.clientHeight,document.documentElement.clientHeight-bounds.top-gap);
      const occupied = entries.filter(other=>other!==entry && !other.panel.hidden).map(other=>rect(other.panel,bounds));
      reserveControls(occupied,bounds);
      const result = findPlacement(panel.offsetWidth,panel.offsetHeight,{x,y},occupied,overlay.clientWidth,height);
      if (result) {
        entry.position = {x:result.x,y:result.y};
        Object.assign(panel.style,{left:result.x+"px",top:result.y+"px"});
      }
    }

    recall.addEventListener("click",()=>{open();if (!panel.hidden) handle.focus();});
    toggle?.addEventListener("click",()=>entry.wanted && !panel.hidden ? close() : open(toggle));
    panel.querySelector(".widget-close")?.addEventListener("click",close);
    if (lock) lock.addEventListener("click",()=>{
      locked = !locked;
      lock.setAttribute("aria-pressed",String(locked));
      lock.title = locked ? "Unlock minimap position" : "Lock minimap position";
      handle.disabled = locked;
    });
    let pointer = null;
    bar.addEventListener("pointerdown", event=>{
      if (locked || event.button!==0 || !entry.position || event.target.closest(".widget-close,[data-widget-lock]")) return;
      bar.setPointerCapture(event.pointerId);
      pointer={id:event.pointerId,x:event.clientX-entry.position.x,y:event.clientY-entry.position.y};
    });
    bar.addEventListener("pointermove",event=>{
      if (pointer?.id===event.pointerId) move(event.clientX-pointer.x,event.clientY-pointer.y);
    });
    bar.addEventListener("lostpointercapture",()=>{pointer=null;});
    handle.addEventListener("keydown",event=>{
      const offset={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[event.key];
      if (locked || !offset || !entry.position) return;
      event.preventDefault();
      move(entry.position.x+offset[0],entry.position.y+offset[1]);
    });
    return {open,close,resetPosition};
  }

  return {register,layout,schedule};
}
