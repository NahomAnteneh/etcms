import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

async function verify() {
  const screenshotDir = path.join(process.cwd(), 'ui-screenshots-verified');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('BROWSER ERR:', msg.text());
  });

  // Test Viewport 1: 1280x800 (Standard Enterprise Laptop)
  await page.setViewport({ width: 1280, height: 800 });
  console.log('Testing 1280x800...');

  // 1. Dashboard on 1280x800 - check all tabs visible
  await page.goto('http://localhost:5173/dashboard', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(screenshotDir, '01-dashboard-1280.png') });

  // 2. Graph View on 1280x800 - check clean handles and visible minimap
  await page.goto('http://localhost:5173/graph', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(screenshotDir, '02-graph-1280.png') });

  // 3. Search in navbar with 'pay' query
  const searchInput = await page.$('input[placeholder*="Search CIs"]');
  if (searchInput) {
    await searchInput.focus();
    await page.keyboard.type('pay');
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: path.join(screenshotDir, '03-search-pay-1280.png') });
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 200));
  }

  // 4. Click Sibling Infrastructure modal in Graph
  const siblingBtn = await page.$('button[aria-label*="Sibling"]');
  if (siblingBtn) {
    await siblingBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(screenshotDir, '04-graph-sibling-modal.png') });
    // Close modal
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));
  }

  // 5. Outage Simulation Toggle
  const outageBtn = await page.$('button ::-p-text(Simulate Outage)');
  if (outageBtn) {
    await outageBtn.click();
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: path.join(screenshotDir, '05-graph-outage-simulation.png') });
    // Restore
    const restoreBtn = await page.$('button ::-p-text(Restore Service)');
    if (restoreBtn) await restoreBtn.click();
    await new Promise((r) => setTimeout(r, 300));
  }

  // 6. Settings - Administration Tab
  await page.goto('http://localhost:5173/settings', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(screenshotDir, '06-settings-admin.png') });

  // 7. Settings - System Tab
  for (const b of await page.$$('button')) {
    const text = (await b.evaluate((el) => el.textContent || '')).trim();
    if (text === 'System') {
      await b.click();
      await new Promise((r) => setTimeout(r, 500));
      await page.screenshot({ path: path.join(screenshotDir, '07-settings-system.png') });
      break;
    }
  }

  // 8. Settings - Roles Tab
  for (const b of await page.$$('button')) {
    const text = (await b.evaluate((el) => el.textContent || '')).trim();
    if (text === 'Roles') {
      await b.click();
      await new Promise((r) => setTimeout(r, 500));
      await page.screenshot({ path: path.join(screenshotDir, '08-settings-roles.png') });
      break;
    }
  }

  // 9. Persona Impersonation Menu
  const personaBtn = await page.$('button[aria-label="Switch User Persona"]');
  if (personaBtn) {
    await personaBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(screenshotDir, '09-persona-menu.png') });
    await personaBtn.click(); // Close
  }

  // 10. Owner Group Menu
  const groupBtn = await page.$('button[aria-label="Filter by Owner Group"]');
  if (groupBtn) {
    await groupBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(screenshotDir, '10-owner-group-menu.png') });
  }

  await browser.close();
  console.log('Verification finished! Saved to ui-screenshots-verified/');
}

verify().catch((err) => {
  console.error(err);
  process.exit(1);
});
