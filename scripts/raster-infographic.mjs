#!/usr/bin/env node
// GitHub's image proxy refuses SVG served from repo paths, so the features
// infographic must ship as a raster. The SVG stays the editable source; this
// renders it to the PNG the README actually references. Run after editing
// either SVG:  node scripts/raster-infographic.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const svg = readFileSync(`screenshots/features-${theme}.svg`, 'utf8');
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:0">${svg}</body>`, { waitUntil: 'load' });
  await page.locator('svg').first().screenshot({ path: `docs/assets/features-${theme}.png` });
  await page.close();
  console.log(`  wrote docs/assets/features-${theme}.png`);
}
await browser.close();
