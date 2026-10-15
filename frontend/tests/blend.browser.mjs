import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { confirmVilla } from './helpers/villa.mjs';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
page.setDefaultTimeout(60000);
try {
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4174');
 await page.locator('#explore-demo').click();
 await confirmVilla(page);
 await page.locator('#export-model').click();
 await page.waitForFunction(()=>!document.querySelector('[data-export=blend]').disabled);
 const download=page.waitForEvent('download');
 await page.locator('[data-export=blend]').click();
 const file=await download;
 assert.match(file.suggestedFilename(),/\.blend$/);
 const bytes=await readFile(await file.path());
 const header = bytes.readUInt32LE(0) === 0xfd2fb528
  ? execFileSync(new URL('../../backend/.venv/bin/python',import.meta.url).pathname, ['-c', 'import sys; from compression import zstd; sys.stdout.buffer.write(zstd.decompress(sys.stdin.buffer.read())[:7])'],{input:bytes}).toString()
  : bytes.subarray(0,7).toString();
 assert.equal(header,'BLENDER');
 console.log('PASS: native headless Blender conversion exports a valid .blend file');
}finally {await browser.close();}
