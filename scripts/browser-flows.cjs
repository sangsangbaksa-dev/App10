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
 await page.click('#backBtn');
 const [fullBackup]=await Promise.all([page.waitForEvent('download'),page.click('#exportBtn')]);
 assert.ok((await fullBackup.path()));assert.match(await page.textContent('#backupStatus'),/마지막 전체 백업 다운로드 요청/);
 const damaged='[{bad json]';await page.evaluate(raw=>localStorage.setItem('pv-prompts-v1',raw),damaged);await page.reload();
 assert.equal(await page.locator('#recovery').isVisible(),true);await page.click('#demoBtn');
 assert.equal(await page.evaluate(()=>localStorage.getItem('pv-prompts-v1')),damaged);
 const [original]=await Promise.all([page.waitForEvent('download'),page.click('#recoveryDownload')]);
 assert.equal(require('node:fs').readFileSync(await original.path(),'utf8'),damaged);
 await page.click('#recoveryReset');await page.click('#confirmOk');await page.waitForFunction(()=>document.querySelector('#recovery').hidden);
 assert.notEqual(await page.evaluate(()=>localStorage.getItem('pv-prompts-v1')),damaged);

};
