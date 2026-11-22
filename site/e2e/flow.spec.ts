// The site in a real browser, driven the way a visitor drives it: by keys,
// clicks and scrolling. The listings are the small set in listings.ts.
import { expect, test, type Page } from '@playwright/test';
import { listings } from './listings.ts';

const data = listings();
const fetched: string[] = [];

test.beforeEach(async ({ page }) => {
  fetched.length = 0;
  await page.route('**/data/*.json.gz', (route) => {
    const name = route.request().url().split('/').pop()!;
    fetched.push(name);
    return route.fulfill({ contentType: 'application/json', body: name.startsWith('london') ? data.london : data.all });
  });
});

const column = (page: Page, title: string) => page.locator('.column', { has: page.locator('.bar h2', { hasText: new RegExp(`^${title}$`) }) });
const choices = (page: Page, title: string) => column(page, title).locator('.facet li:not(.note):not(.heads)');
const showtimes = (page: Page) => page.locator('.column.showtimes .cards li.show');
const titles = (page: Page) => page.locator('.columns .bar h2');
const total = (page: Page) => page.locator('.column.showtimes .bar .count');
/** Type a command on the command line, as after : in vim. */
async function ex(page: Page, command: string) {
  await page.keyboard.press(':');
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}
/** Open an address and wait until the finder is drawn, so that keys pressed next reach it. */
async function visit(page: Page, address: string) {
  await page.goto(address);
  await expect(page.locator('.column.showtimes .bar .count')).toHaveText(/\d/);
}

test('the site opens on the finder, with the default columns and a quick start', async ({ page }) => {
  await visit(page, '/');
  await expect(titles(page)).toHaveText(['Chain', 'Cinema', 'Film', 'Showtimes', /./]);
  await expect(total(page)).toHaveText('254'); // event cinema left out
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Dune/, /^Paddington/]);
});

test('keys choose in each column, each counts what the others leave, and the address keeps it', async ({ page }) => {
  await visit(page, '/#cols=day,film,cinema,picture');
  await page.keyboard.press('ArrowRight'); // to Film
  await page.keyboard.press('ArrowDown'); // Dune
  await expect(total(page)).toHaveText('3');
  await expect(choices(page, 'Cinema')).toHaveText([/^All/, /^Aberdeen\s*1$/, /^Holloway\s*1$/, /^West End\s*1$/]);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight'); // to Picture
  await page.keyboard.press('ArrowDown'); // IMAX
  await expect(total(page)).toHaveText('1');
  await expect(page).toHaveURL(/\/#cols=day,film,cinema,picture&film=odeon-F1&picture=IMAX&col=4$/);
  await page.reload();
  await expect(total(page)).toHaveText('1');
  await expect(column(page, 'Picture')).toHaveClass(/focused/);
  await page.keyboard.press('g');
  await page.keyboard.press('g'); // the first line: All
  await expect(total(page)).toHaveText('3');
  await page.locator('header h1 a').click(); // the default view, which needs nothing after the address
  await expect(titles(page)).toHaveText(['Chain', 'Cinema', 'Film', 'Showtimes', /./]);
  await expect(page).toHaveURL(/\/$/);
});

test('vim keys move between and through the columns', async ({ page }) => {
  await visit(page, '/#cols=day,film,cinema,picture');
  await page.keyboard.press('l'); // to Film
  await expect(column(page, 'Film')).toHaveClass(/focused/);
  await page.keyboard.press('G'); // the last film
  await expect(column(page, 'Film').locator('li.selected')).toContainText('Paddington');
  await page.keyboard.press('g');
  await page.keyboard.press('g'); // back to the top: All
  await expect(column(page, 'Film').locator('li.selected')).toContainText('All');
  await page.keyboard.press('j');
  await expect(column(page, 'Film').locator('li.selected')).toContainText('Dune');
  await page.keyboard.press('$'); // the showtimes
  await expect(page.locator('.column.showtimes')).toHaveClass(/focused/);
  await page.keyboard.press('h');
  await expect(column(page, 'Picture')).toHaveClass(/focused/);
  await page.keyboard.press('0');
  await expect(column(page, 'Day')).toHaveClass(/focused/);
  await page.keyboard.press('2');
  await page.keyboard.press('l'); // a count: two columns on
  await expect(column(page, 'Cinema')).toHaveClass(/focused/);
});

test('/ and ? search a column as vim does, dd hides, u and Ctrl-r undo and redo, and :help lists it all', async ({ page }) => {
  await visit(page, '/#col=3');
  await page.keyboard.press('/');
  await page.keyboard.type('padd'); // found as it is typed
  await expect(column(page, 'Film').locator('li.selected')).toContainText('Paddington');
  await page.keyboard.press('Enter');
  await page.keyboard.press('?');
  await page.keyboard.type('du');
  await page.keyboard.press('Enter'); // back to Dune
  await expect(column(page, 'Film').locator('li.selected')).toContainText('Dune');
  await page.keyboard.press('/');
  await page.keyboard.type('pxyz'); // p matches as it is typed; pxyz does not
  await page.keyboard.press('Enter');
  await expect(page.locator('.cmdline .message')).toHaveText('E486: Pattern not found: pxyz');
  await expect(column(page, 'Film').locator('li.selected')).toContainText('Dune'); // where it was
  await page.keyboard.press('d');
  await page.keyboard.press('d'); // dd hides the film
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Paddington/]);
  await page.keyboard.press('u');
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Dune/, /^Paddington/]);
  await expect(page).not.toHaveURL(/hidden=/);
  await page.keyboard.press('Control+r');
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Paddington/]);
  await ex(page, 'nonsense');
  await expect(page.locator('.cmdline .message')).toHaveText('E492: Not an editor command: nonsense');
  await ex(page, 'help');
  await expect(page.locator('dialog.keylist')).toBeVisible();
  await expect(page.locator('dialog.keylist dt').filter({ hasText: 'zz  zt  zb' })).toHaveCount(1);
  await page.keyboard.press('q');
  await expect(page.locator('dialog.keylist')).toBeHidden();
});

test('vim keys move through the showtimes by count, day and screen', async ({ page }) => {
  await visit(page, '/#film=odeon-F2&col=4'); // Paddington: one showing on day 1, then ten a day from day 3
  const selected = () => showtimes(page).evaluateAll((rows) => rows.findIndex((row) => row.classList.contains('selected')));
  await page.keyboard.press('}');
  await expect.poll(selected).toBe(1); // the next day
  await page.keyboard.press('}');
  await expect.poll(selected).toBe(11);
  await page.keyboard.press('{');
  await expect.poll(selected).toBe(1); // the day before's start
  await page.keyboard.press('{');
  await expect.poll(selected).toBe(0);
  for (const key of ['2', '5', 'G']) await page.keyboard.press(key);
  await expect.poll(selected).toBe(24); // row 25
  await page.keyboard.press('3');
  await page.keyboard.press('k');
  await expect.poll(selected).toBe(21);
  await page.keyboard.press('L'); // the bottom of what is on screen
  await expect.poll(selected).toBeGreaterThan(21);
  await page.keyboard.press('H');
  await expect.poll(selected).toBeLessThanOrEqual(21);
});

test('the highlighted showtime shows its details and its double bill, which can be followed', async ({ page }) => {
  await visit(page, '/#film=odeon-F1&col=3');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  const details = page.locator('.column.details');
  await expect(details.locator('.bar h2')).toHaveText('Dune · 18:00');
  await expect(details.locator('.bills li.day')).toHaveText('Straight after this');
  await expect(details.locator('h3')).toHaveText('Dune'); // the film's own details follow
  await details.locator('.bills li', { hasText: 'Paddington' }).click();
  await expect(column(page, 'Film').locator('li.selected')).toContainText('Paddington');
  await expect(details.locator('.bar h2')).toHaveText('Paddington · 20:50');
});

test('the settings add, move and remove columns, and a bookmark keeps the view', async ({ page }) => {
  await visit(page, '/#cols=day,film,cinema,picture');
  await ex(page, 'set');
  const panel = page.locator('dialog.panel');
  await panel.getByRole('button', { name: 'Add Screen' }).click();
  await panel.getByRole('button', { name: 'Move Screen left' }).click();
  await panel.getByRole('button', { name: 'Move Screen left' }).click(); // past Picture, then Cinema
  await panel.getByRole('button', { name: 'Remove Picture' }).click();
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(titles(page)).toHaveText(['Day', 'Film', 'Screen', 'Cinema', 'Showtimes', /./]);
  await expect(choices(page, 'Screen').nth(1)).toContainText('#1 West End300 seats');
  const bookmark = page.url();
  expect(bookmark).toMatch(/\/#cols=day,film,screen,cinema$/);
  await page.goto('about:blank');
  await visit(page, bookmark);
  await expect(titles(page)).toHaveText(['Day', 'Film', 'Screen', 'Cinema', 'Showtimes', /./]);
});

test(':vs adds a column, << and >> move it, :q and :only close them', async ({ page }) => {
  await visit(page, '/#cols=day,film,cinema,picture&col=2');
  await page.keyboard.press('>');
  await page.keyboard.press('>');
  await expect(titles(page)).toHaveText(['Day', 'Cinema', 'Film', 'Picture', 'Showtimes', /./]);
  await expect(column(page, 'Film')).toHaveClass(/focused/);
  await page.keyboard.press('2');
  await page.keyboard.press('<');
  await page.keyboard.press('<'); // a count: two places
  await expect(titles(page)).toHaveText(['Film', 'Day', 'Cinema', 'Picture', 'Showtimes', /./]);
  await ex(page, 'q');
  await expect(titles(page)).toHaveText(['Day', 'Cinema', 'Picture', 'Showtimes', /./]);
  await expect(page).toHaveURL(/cols=day,cinema,picture/);
  await ex(page, 'vs screen'); // after the column in hand
  await expect(titles(page)).toHaveText(['Day', 'Screen', 'Cinema', 'Picture', 'Showtimes', /./]);
  await ex(page, 'only');
  await expect(titles(page)).toHaveText(['Screen', 'Showtimes', /./]);
});

test('Tab completes commands as vim\'s wildmenu does', async ({ page }) => {
  await visit(page, '/#col=3');
  const command = page.locator('.cmdline input');
  const wildmenu = page.locator('.cmdline .wildmenu');
  await page.keyboard.press(':');
  await page.keyboard.type('vs ');
  await page.keyboard.press('Tab'); // the columns not shown yet
  await expect(wildmenu).toBeVisible();
  await expect(wildmenu.locator('span').first()).toHaveText('day');
  await expect(command).toHaveValue('vs day');
  await page.keyboard.press('Tab');
  await expect(command).toHaveValue('vs location');
  await page.keyboard.press('Shift+Tab');
  await expect(command).toHaveValue('vs day');
  await page.keyboard.press('Enter');
  await expect(titles(page)).toHaveText(['Chain', 'Cinema', 'Film', 'Day', 'Showtimes', /./]);
  await page.keyboard.press(':');
  await page.keyboard.type('set fields+=');
  await page.keyboard.press('Tab'); // the fields not shown yet
  await expect(command).toHaveValue('set fields+=ends');
  await page.keyboard.press('Escape');
  await page.keyboard.press(':');
  await page.keyboard.type('so');
  await page.keyboard.press('Tab'); // one match: completed, no menu
  await expect(command).toHaveValue('sort');
  await expect(wildmenu).toBeHidden();
});

test('the settings drawer is driven by keys too', async ({ page }) => {
  await visit(page, '/');
  await ex(page, 'set');
  const panel = page.locator('dialog[aria-label="Settings"]');
  await expect(panel).toBeVisible();
  await page.keyboard.press('/');
  await page.keyboard.type('london only');
  await page.keyboard.press('Enter');
  await page.keyboard.press(' '); // ticks the line in hand
  await expect(page).toHaveURL(/\?cinemas=london$/);
  await page.keyboard.press('/');
  await page.keyboard.type('every film');
  await page.keyboard.press('Enter');
  await page.keyboard.press('d');
  await page.keyboard.press('d'); // removes that column
  await expect(titles(page)).toHaveText(['Chain', 'Cinema', 'Showtimes', /./]);
  await page.keyboard.press('u');
  await expect(titles(page)).toHaveText(['Chain', 'Cinema', 'Film', 'Showtimes', /./]);
  await page.keyboard.press('/');
  await page.keyboard.type('every film');
  await page.keyboard.press('Enter');
  await page.keyboard.press('<');
  await page.keyboard.press('<'); // Film moved left
  await expect(titles(page)).toHaveText(['Chain', 'Film', 'Cinema', 'Showtimes', /./]);
  await ex(page, 'q');
  await expect(panel).toBeHidden();
  await page.keyboard.press(':');
  await page.keyboard.type('redo'); // nothing undone since: already at the newest
  await page.keyboard.press('Enter');
  await expect(page.locator('.cmdline .message')).toHaveText('Already at newest change');
});

test(':filter narrows a column and :sort orders it', async ({ page }) => {
  await visit(page, '/#col=3');
  await ex(page, 'filter padd');
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Paddington/]);
  await page.keyboard.press('j');
  await expect(total(page)).toHaveText('251');
  await ex(page, 'filter'); // all of them again
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Dune/, /^Paddington/]);
  await ex(page, 'sort n'); // by how many showings
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Paddington/, /^Dune/]);
  await expect(page).toHaveURL(/order=film:count/);
  await page.keyboard.press('$');
  await ex(page, 'sort! seats');
  await expect(page).toHaveURL(/sort=seats&desc=1/);
  await ex(page, 'set fields+=ends fields-=picture');
  await expect(page).toHaveURL(/fields=ends,cinema,screen/);
  await ex(page, 'set fields&');
  await expect(page).not.toHaveURL(/fields=/);
});

test('a long list of showtimes draws more as the reader scrolls and as the highlight moves', async ({ page }) => {
  await visit(page, '/#col=4');
  await expect(showtimes(page)).toHaveCount(100);
  await page.locator('.column.showtimes').evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(showtimes(page)).toHaveCount(200);
  for (let press = 0; press < 205; press += 1) await page.keyboard.press('ArrowDown');
  await expect(showtimes(page)).toHaveCount(254);
  await expect(showtimes(page).nth(205)).toHaveClass(/selected/);
});

test('the window holds the columns clear of the footer, and a highlighted row clear of its heading', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await visit(page, '/#col=4');
  for (const [key, times] of [['ArrowDown', 40], ['ArrowUp', 30]] as const) for (let press = 0; press < times; press += 1) await page.keyboard.press(key);
  const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  const [strip, footer, heads, row] = [await box('.columns'), await box('footer'), await box('.showtimes li.heads'), await box('.showtimes .selected')];
  expect(strip.y + strip.height).toBeLessThanOrEqual(footer.y + 1);
  expect(row.y).toBeGreaterThanOrEqual(heads.y + heads.height - 1);
});

test('the showtimes are headed, a heading orders them, and the settings choose what they show', async ({ page }) => {
  await visit(page, '/#film=odeon-F1');
  const heads = page.locator('.showtimes li.heads');
  await expect(heads).toHaveText(/Time.*Picture.*Cinema.*Screen$/); // the film is chosen, so not repeated
  await ex(page, 'set fields+=seats');
  await expect(heads).toHaveText(/Time.*Picture.*Cinema.*Screen.*Seats/);
  await expect(page.locator('.column.film li.heads')).toHaveText(/IMDb.*showings/);
  await heads.getByRole('button', { name: 'Order by seats' }).click();
  await expect(page).toHaveURL(/sort=seats/);
  await expect(heads).toHaveText(/Day.*Seats ▲/); // out of date order, each row says its day
  await heads.getByRole('button', { name: /Order by seats/ }).click();
  await expect(page).toHaveURL(/sort=seats&desc=1/);
  await page.locator('header .open-panel').click();
  const panel = page.locator('dialog.panel');
  await panel.locator('[data-key="field-ends"]').check();
  await panel.locator('[data-key="field-picture"]').uncheck();
  await page.keyboard.press('Escape');
  await expect(heads).toHaveText(/Time.*Ends.*Cinema/);
  await expect(heads).not.toHaveText(/Picture/);
  await expect(page).toHaveURL(/fields=ends,cinema,screen,seats/);
});

test('London only, at the top of the settings, is ?cinemas=london and loads only its listings', async ({ page }) => {
  await visit(page, '/');
  await page.locator('header .open-panel').click();
  const london = page.locator('dialog.panel').getByLabel(/London only/);
  await london.check();
  await expect(page).toHaveURL(/\?cinemas=london$/);
  await page.keyboard.press('Escape');
  await expect(choices(page, 'Cinema')).toHaveText([/^All/, /^Holloway/, /^West End/]);
  const bookmark = page.url();
  await page.goto('about:blank'); // a fresh visit, as from the bookmark
  fetched.length = 0;
  await visit(page, bookmark);
  expect(fetched).toEqual(['london.json.gz']);
  await ex(page, 'set nolondon');
  await expect(page).not.toHaveURL(/cinemas=/);
  await expect(choices(page, 'Cinema')).toHaveText([/^All/, /^Aberdeen/, /^Holloway/, /^West End/]);
  expect(fetched).toEqual(['london.json.gz', 'listings.json.gz']); // every cinema, fetched once needed
  await page.locator('header .open-panel').click();
  await expect(london).not.toBeChecked();
  await expect(page.locator('header .open-panel')).toHaveText('Settings');
});

test('event cinema and single cinemas are chosen in the settings', async ({ page }) => {
  await visit(page, '/');
  await page.getByRole('button', { name: /^Settings/ }).click();
  const panel = page.locator('dialog.panel');
  await panel.getByLabel(/Show event cinema/).check();
  await expect(page).toHaveURL(/\?show=events$/);
  await panel.getByLabel(/Choose cinemas/).check();
  await panel.getByPlaceholder('Search cinemas or towns').fill('aber');
  await expect(panel.locator('.cinemas > li')).toHaveCount(1); // the search narrows the list
  await panel.getByLabel(/^ ?Aberdeen$/).check();
  await expect(page).toHaveURL(/cinemas=odeon-001/);
  await expect(panel.getByRole('button', { name: 'Untick Aberdeen' })).toBeVisible(); // a chip for each ticked cinema
  await page.keyboard.press('Escape');
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Dune/]);
  await visit(page, '/?show=events');
  await expect(choices(page, 'Film')).toHaveText([/^All/, /^Dune/, /^Opera Live/, /^Paddington/]);
});

test('a phone shows one column at a time, and a choice moves on to the next', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); // an iPhone 13 mini
  await visit(page, '/');
  await expect(page.locator('.column:visible .bar h2')).toHaveText('Chain');
  // The header is one line, and there is no footer.
  expect((await page.locator('header').boundingBox())!.height).toBeLessThan(50);
  await expect(page.locator('footer')).toBeHidden();
  // Nothing in a column is wider than the screen, so it cannot be dragged sideways.
  const wider = () => page.locator('.column:visible').evaluate((column) => column.scrollWidth - column.clientWidth);
  await expect.poll(wider).toBe(0);
  await page.locator('.column.chain li', { hasText: 'All' }).first().click(); // All moves on too
  await expect(page.locator('.column:visible .bar h2')).toHaveText('Cinema');
  await page.locator('.column.cinema li', { hasText: 'All' }).first().click();
  await expect(page.locator('.column:visible .bar h2')).toHaveText('Film');
  await page.locator('.column.film li', { hasText: 'Dune' }).click();
  await expect(page.locator('.column:visible')).toHaveClass(/showtimes/);
  await expect.poll(wider).toBe(0);
  await showtimes(page).first().click();
  await expect(page.locator('.column:visible')).toHaveClass(/details/);
  await expect.poll(wider).toBe(0);
  await expect(page.locator('.column.details .actions a')).toHaveText('Book on odeon.co.uk');
  // Out of date order each row adds its day; what no longer fits is left out, and the seats stay.
  await visit(page, '/#fields=picture,cinema,screen,seats&sort=seats&col=4');
  await expect(page.locator('.showtimes li.heads')).toHaveText(/^Day.*Seats ▲$/);
  await expect.poll(wider).toBe(0);
});

test('more than one chain: films shared, a Chain column, each cinema marked and booked with its own chain', async ({ page }) => {
  const two = listings(true);
  await page.route('**/data/*.json.gz', (route) => route.fulfill({ contentType: 'application/json', body: route.request().url().includes('london') ? two.london : two.all }));
  await visit(page, '/#cols=chain,cinema,film');
  await expect(choices(page, 'Chain')).toHaveText([/^All/, /^Everyman\s*2$/, /^ODEON\s*254$/]);
  await expect(page.locator('.column.cinema li.heads')).toHaveText(/chain/);
  await expect(choices(page, 'Cinema').filter({ hasText: 'Hampstead' })).toHaveText(/Hampstead\s*Everyman\s*1/);
  // Dune at Everyman is the same film as ODEON's Dune.
  await expect(choices(page, 'Film').filter({ hasText: /^Dune/ })).toHaveText(/^Dune\s*★8.4\s*4$/);
  await page.keyboard.press('j'); // Everyman
  await page.keyboard.press('$'); // the showtimes, the first highlighted
  await expect(page.locator('.column.details .actions a').first()).toHaveText('Book on everymancinema.com');
  await expect(page.locator('.column.details .actions a').first()).toHaveAttribute('href', 'https://purchase.everymancinema.com/launch/ticketing/uuid-1');
  await expect(page.locator('.column.details')).toContainText('Laser');
  // Greater London is known by postcode for chains that do not list it themselves.
  await ex(page, 'set london');
  await expect(choices(page, 'Cinema')).toHaveText([/^All/, /^Hampstead/]); // Everyman is still chosen
  await page.keyboard.press('0');
  await page.keyboard.press('g');
  await page.keyboard.press('g'); // every chain again
  await expect(choices(page, 'Cinema')).toHaveText([/^All/, /^Hampstead/, /^Holloway/, /^West End/]);
});


test('the footer and :help show which version is running, linked to its commit, and the GitHub repository', async ({ page }) => {
  await visit(page, '/');
  const about = page.locator('footer .about');
  // A commit when the build knows it (Deploy, or a git checkout); CI's site check builds without one.
  await expect(about.locator('a.version')).toHaveText(/^version ((\S+ )?[0-9a-f]{7}|local build)$/);
  await expect(about.locator('a.version')).toHaveAttribute('href', /^https:\/\/github\.com\/RoshBeed\/showtimes(\/commit\/[0-9a-f]{40})?$/);
  await expect(about.locator('a.github')).toHaveAttribute('href', 'https://github.com/RoshBeed/showtimes');
  await ex(page, 'help');
  await expect(page.locator('dialog.keylist .about a.version')).toHaveText(await about.locator('a.version').innerText());
});
