const assert=require('node:assert/strict');
module.exports=async function(page,base){
 await page.goto(base+'/');await page.click('#newBtn');await page.fill('#fTitle','검증 프롬프트');await page.fill('#fBody','Hello {{이름}} <script>alert(1)</script>');await page.fill('#fDefaults','이름=민수');await page.click('#editForm [type=submit]');
 await page.waitForFunction(()=>document.querySelector('#preview').textContent.includes('민수'));
 assert.equal(await page.locator('#preview script').count(),0);
 await page.click('#copyBtn');await page.waitForFunction(()=>JSON.parse(localStorage['pv-prompts-v1'])[0].useCount>0);
 await page.click('#editBtn');await page.fill('#fBody','Changed {{이름}}');await page.click('#editForm [type=submit]');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage['pv-prompts-v1'])[0].history.length),1);
 await page.reload();await page.locator('#list .card-btn').first().click();assert.ok((await page.textContent('#detailTitle')).includes('검증 프롬프트'));
 await page.click('#dupBtn');assert.equal(await page.evaluate(()=>JSON.parse(localStorage['pv-prompts-v1']).length),2);
};
