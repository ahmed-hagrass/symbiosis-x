// Flight groups its top-bar buttons into Mission, Crew and Ship menus.
// Waits for the button, opens the menu that holds it (if any), then returns it.
// `target` is the button's exact label, or a CSS id selector such as "#end-mission".
export async function hudButton(page, target) {
  const css = target.startsWith("#") ? target : null;
  const handle = await page.waitForFunction(({ name, css }) => {
    const candidates = css ? [document.querySelector(css)].filter(Boolean)
      : [...document.querySelectorAll("button")].filter(button => button.textContent.trim() === name);
    const shown = button => !button.hidden && button.checkVisibility({ visibilityProperty: true });
    if (candidates.some(shown)) return { trigger: "" };
    const inMenu = candidates.find(button => !button.hidden && button.closest(".hud-menu")?.checkVisibility());
    return inMenu ? { trigger: inMenu.closest(".hud-menu").querySelector(".hud-menu-trigger").id } : null;
  }, { name: target, css });
  const { trigger } = await handle.jsonValue();
  if (trigger) await page.locator("#" + trigger).click();
  return css ? page.locator(css) : page.getByRole("button", { name: target, exact: true }).first();
}
