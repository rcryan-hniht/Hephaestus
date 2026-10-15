import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
page.setDefaultTimeout(15000);
try {
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4175');
 await page.locator('[data-upload]').first().click();
 const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=20;c.height=10;return c.toDataURL().split(',')[1];}),'base64');
 await page.locator('#file-input').setInputFiles([1,2].map(n=>({name:`F${n}_scaled.png`,mimeType:'image/png',buffer:png})));
 for (const n of [1,2]) {
  await page.locator('#source-floor').selectOption(String(n));
  await page.locator('#api-questions').waitFor({state:'visible'});
  assert.equal(await page.locator('#question-review_confirmed').isChecked(),false);
  await page.getByRole('button',{name:'Use all suggestions',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('question-floor_height')?.value === '2.7');
  assert.equal(await page.locator('#question-review_confirmed').isChecked(),false);
  assert.equal(await page.locator('#question-meters_per_unit').inputValue(),'');
  await page.locator('#question-meters_per_unit').fill('.1');
  await page.locator('#question-review_confirmed').check();

 }
 await page.locator('#confirm-drawing').click();
 for (const n of [1,2]) await page.waitForFunction(n => document.getElementById(`floor-status-${n}`).textContent.includes('Ready'), n);
 assert.match(await page.locator('#building-summary').textContent(),/2 drawings · 2 floors received/);
 await page.locator('#confirm-alignment').click();
 await page.waitForFunction(()=>document.getElementById('model-label').textContent.includes('2 FLOORS'));
 const downloaded=page.waitForEvent('download');await page.locator('#export-scene').click();
 const scene=JSON.parse(await readFile(await (await downloaded).path(),'utf8'));
 assert.equal(scene.components.filter(c=>c.type==='wall').length,2);
 assert.deepEqual(scene.components.map(c=>c.floor),[0,1]);
 assert.deepEqual(scene.components.map(c=>c.elevation),[0,2.7]);
 assert.equal(scene.floors[0].scene.source_kind,'png');
 assert.equal(scene.floors[1].scene.parameters.review_confirmed.value,true);
 console.log('PASS: two PNGs in one backend batch, per-floor explicit review/scale and wall-bearing 3D assembly');
}finally {await browser.close();}
