import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function run() {
  const evidenceDir = path.join(process.cwd(), '.sisyphus', 'evidence');
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('http://localhost:4141/admin/');
  await page.fill('input[type="password"]', 'test');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Overview');

  await page.click('a[href="#accounts"]');
  await page.waitForSelector('h1:has-text("Accounts")');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(evidenceDir, 'task-16-accounts-page.png') });

  await page.click('button:has-text("Add Account")');
  await page.waitForSelector('text=Add GitHub Account');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(evidenceDir, 'task-16-device-flow.png') });

  await page.click('button:has-text("Cancel")');
  await page.waitForSelector('text=Add GitHub Account', { state: 'hidden' });

  await page.click('a[href="#keys"]');
  await page.waitForSelector('h1:has-text("API Keys")');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(evidenceDir, 'task-16-keys-page.png') });

  await page.fill('input[placeholder="New key name..."]', 'playwright-test-key');
  await page.click('button:has-text("Create Key")');
  await page.waitForSelector('text=API Key Created Successfully');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(evidenceDir, 'task-16-key-created.png') });

  await page.click('button:has-text("Export Config")');
  await page.waitForSelector('text=OpenCode Configuration');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(evidenceDir, 'task-16-opencode-config.png') });

  await browser.close();
  console.log('Screenshots taken successfully.');
}

run().catch(console.error);
