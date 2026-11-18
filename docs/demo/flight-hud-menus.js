// Flight top bar: groups the existing ribbon buttons into Mission ▾, Crew ▾
// and Ship ▾ menus that open directly under their word. The buttons keep their
// ids, labels and handlers; only where they are shown changes.
function bindFlightHudMenus({ribbon, groups, sound}) {
  const menus = [];
  const finePointer = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

  function close(menu, {focus = false, quiet = false} = {}) {
    if (!menu.root.hasAttribute("data-open")) return;
    delete menu.root.dataset.open;
    menu.trigger.setAttribute("aria-expanded", "false");
    if (!quiet) sound?.play("menu-close");
    if (focus) menu.trigger.focus();
  }
  function open(menu, by = "click") {
    for (const other of menus) if (other !== menu) close(other, {quiet:true});
    if (menu.root.hasAttribute("data-open")) return;
    menu.openedBy = by;
    menu.openedAt = performance.now();
    menu.root.dataset.open = "";
    menu.trigger.setAttribute("aria-expanded", "true");
    sound?.play("menu-open");
  }
  const visibleItems = menu => [...menu.list.children].flatMap(node =>
    node.matches("button") ? [node] : [...node.querySelectorAll("button")]).filter(button => !button.hidden);

  for (const group of groups) {
    const root = document.createElement("div");
    root.className = "hud-menu";
    root.dataset.menu = group.id;
    if (group.tone) root.dataset.tone = group.tone;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "hud-menu-trigger";
    trigger.id = "hud-menu-" + group.id;
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", "hud-menu-list-" + group.id);
    trigger.innerHTML = '<span></span><svg class="hud-caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    trigger.firstChild.textContent = group.label;
    const list = document.createElement("div");
    list.className = "hud-menu-list";
    list.id = "hud-menu-list-" + group.id;
    list.setAttribute("aria-label", group.label + " menu");
    list.setAttribute("role", "group");
    const menu = {root, trigger, list, group};
    for (const section of group.sections) {
      if (section.title) {
        const heading = document.createElement("p");
        heading.className = "hud-menu-heading";
        heading.textContent = section.title;
        list.append(heading);
      }
      for (const item of section.items) {
        if (!item) continue;
        item.classList.add("hud-menu-item");
        list.append(item);
      }
    }
    root.append(trigger, list);
    menus.push(menu);

    trigger.addEventListener("click", () => {
      // A click right after hover opened the menu keeps it open instead of closing it.
      const justHovered = menu.openedBy === "hover" && performance.now() - menu.openedAt < 800;
      if (!root.hasAttribute("data-open")) open(menu);
      else if (!justHovered) close(menu);
    });
    trigger.addEventListener("keydown", event => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        open(menu);
        visibleItems(menu)[0]?.focus();
      }
    });
    list.addEventListener("keydown", event => {
      const items = visibleItems(menu);
      const at = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        items[(at + step + items.length) % items.length]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        close(menu, {focus:true});
      }
    });
    // Choosing an item closes the menu after its own handler has run.
    list.addEventListener("click", event => {
      if (event.target.closest("button")) setTimeout(() => close(menu, {quiet:true}));
    });
    if (finePointer) {
      let timer = 0;
      root.addEventListener("pointerenter", event => {
        if (event.pointerType !== "mouse") return;
        clearTimeout(timer);
        timer = setTimeout(() => open(menu, "hover"), 90);
      });
      root.addEventListener("pointerleave", event => {
        if (event.pointerType !== "mouse") return;
        clearTimeout(timer);
        timer = setTimeout(() => close(menu, {quiet:true}), 220);
      });
    }
  }

  document.addEventListener("pointerdown", event => {
    for (const menu of menus) if (!menu.root.contains(event.target)) close(menu, {quiet:true});
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const openMenu = menus.find(menu => menu.root.hasAttribute("data-open"));
    if (openMenu) { event.preventDefault(); close(openMenu, {focus:openMenu.root.contains(document.activeElement)}); }
  });

  // A menu with nothing to offer right now hides its word.
  function sync() {
    for (const menu of menus) menu.root.hidden = visibleItems(menu).length === 0;
  }
  const watch = new MutationObserver(sync);
  for (const menu of menus) watch.observe(menu.list, {attributes:true, subtree:true, attributeFilter:["hidden"], childList:true});

  const anchor = ribbon.querySelector(".cam-crumbs") ?? ribbon.querySelector(".resource");
  const bar = document.createElement("div");
  bar.className = "hud-menus";
  bar.append(...menus.map(menu => menu.root));
  anchor.after(bar);
  sync();
  return {close:() => menus.forEach(menu => close(menu, {quiet:true})), sync, menus};
}
