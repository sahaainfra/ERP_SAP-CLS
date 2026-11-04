// Helpers for the application shell (part 03.05): on a phone the menu is closed until its button is pressed, and the theme, language and
// sign-out live in the account menu. Specs go through these so they read the same on desktop and mobile.

/** The main navigation, opened first when the viewport keeps it behind the menu button. */
export async function menu(page) {
  const nav = page.locator('#sh-nav'); // named Main in English; its name follows the language of the screen
  await page.locator('#sh-nav').waitFor({ state: 'attached' }); // the shell has drawn (on a phone it is there but hidden)
  if (!(await nav.isVisible())) await page.locator('.sh-burger, [data-testid="bottom-more"]').filter({ visible: true }).first().click(); // the button is named Open menu in English
  return nav;
}

/** The account menu (language, theme, sign out), opened. */
export async function userMenu(page) {
  const button = page.getByTestId('user-menu');
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  return page.locator('.sh-user-pop'); // its name is the account menu in the language of the screen
}

export async function setTheme(page, theme) {
  await (await userMenu(page)).getByLabel('Theme').selectOption(theme);
}

export async function signOut(page) {
  await (await userMenu(page)).getByRole('menuitem', { name: 'Sign out' }).click();
}
