import { showLandingActions } from './helpers/landing.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(10000);
try {
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4174');
 await showLandingActions(page); await page.locator('[data-upload]').first().click();
 const source = new URL('../../backend/tests/fixtures/known_rooms.svg', import.meta.url).pathname;
 const svg = await readFile(source);
 await page.locator('#file-input').setInputFiles([1, 2].map(n => ({ name: `F${n}.svg`, mimeType: 'image/svg+xml', buffer: svg })));
 await page.locator('#api-questions').waitFor({ state: 'visible' });
 await page.locator('#file-input').setInputFiles(source);
 await page.locator('#api-questions').waitFor({ state: 'visible' });
 assert.equal(await page.locator('#confirm-drawing').isVisible(), true);
 assert.equal(await page.locator('#confirm-drawing').evaluate(button => button.closest('#floor-alignment') === null && button.form.id === 'api-questions'), true, 'Single-source build stays reachable after replacing a batch');
 await page.locator('#question-meters_per_unit').fill('.01');
 await page.locator('#question-floor_height').fill('4');
 await page.getByRole('button', { name: 'Use all suggestions', exact: true }).click();
 await page.waitForFunction(() => document.getElementById('question-door_height')?.value === '2.1');
 assert.equal(await page.locator('#question-meters_per_unit').inputValue(), '.01');
 for (const [key,value] of Object.entries({ floor_height:'4', slab_thickness:'.2', door_height:'2.1', window_height:'1.2', window_sill:'.9' })) assert.equal(Number(await page.locator(`#question-${key}`).inputValue()), Number(value));
 assert.equal(await page.locator('#model-label').isVisible(), false);
 await page.locator('#confirm-drawing').click();
 await page.waitForFunction(() => document.getElementById('processing-status').textContent.startsWith('Ready ·'));
 console.log('PASS: one-click suggestions fill every dimension, preserve scale and require explicit build confirmation');
} finally { await browser.close(); }
