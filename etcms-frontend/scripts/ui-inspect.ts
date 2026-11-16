import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

async function run() {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();

  // Capture console logs and errors
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', msg.text());
    }
  });
  page.on('pageerror', (err) => {
    console.log('BROWSER PAGE ERROR:', err.message);
  });

  const screenshotDir = path.join(process.cwd(), 'ui-screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  // 1. Dashboard
  console.log('Navigating to dashboard...');
  await page.goto('http://localhost:5173/dashboard', { waitUntil: 'networkidle2' });
  await page.waitForSelector('header', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(screenshotDir, '01-dashboard.png') });

  // 2. Graph view
  console.log('Navigating to graph...');
  await page.goto('http://localhost:5173/graph', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(screenshotDir, '02-graph.png') });

  // 3. Navbar search
  console.log('Testing navbar search...');
  await page.focus('input[placeholder*="Search CIs"]');
  await page.keyboard.type('pay');
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(screenshotDir, '03-search-dropdown.png') });

  // Clear search
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));

  // 4. Settings view
  console.log('Navigating to settings...');
  await page.goto('http://localhost:5173/settings', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(screenshotDir, '04-settings-administration.png') });

  // Click on "Roles" tab
  const rolesButton = await page.$('button ::-p-text(Roles)');
  if (rolesButton) {
    await rolesButton.click();
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(screenshotDir, '05-settings-roles.png') });
  }

  // Click on "Users" tab
  const usersButton = await page.$('button ::-p-text(Users)');
  if (usersButton) {
    await usersButton.click();
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(screenshotDir, '06-settings-users.png') });
  }

  // Click on "System" tab
  const systemButton = await page.$('button ::-p-text(System)');
  if (systemButton) {
    await systemButton.click();
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(screenshotDir, '07-settings-system.png') });
  }

  // 5. Catalog view
  console.log('Navigating to catalog...');
  await page.goto('http://localhost:5173/catalog', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(screenshotDir, '08-catalog.png') });

  await browser.close();
  console.log('Screenshots saved to ui-screenshots/');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
