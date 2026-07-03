import puppeteer from 'puppeteer';
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  try {
    await page.goto('http://localhost:8080/login');
    await page.type('input[type=email]', 'admin@nebula.com'); // This user must exist or we need to register
    await page.type('input[type=password]', 'admin123');
    await page.click('button[type=submit]');
    await page.waitForNavigation();
  } catch (err) {
    console.log('Login failed (maybe user does not exist), trying to register...');
    await page.goto('http://localhost:8080/register');
    await page.type('input[name=name]', 'Test');
    await page.type('input[name=organization]', 'Test Org');
    await page.type('input[type=email]', 'test@codilty.com');
    await page.type('input[type=password]', 'password');
    await page.click('button[type=submit]');
    await page.waitForNavigation();
  }

  await page.goto('http://localhost:8080/overview');
  console.log('Overview page loaded.');
  await new Promise(r=>setTimeout(r, 2000));

  await page.goto('http://localhost:8080/jobs');
  console.log('Jobs page loaded.');
  await page.waitForSelector('.btn-ghost', {timeout: 5000});
  
  const buttons = await page.$$('.btn-ghost');
  if(buttons.length > 0) {
    console.log('Clicking eye button...');
    await buttons[0].click();
  }
  
  await new Promise(r=>setTimeout(r, 2000));
  
  const enqueueBtn = await page.$$('.btn-primary');
  if(enqueueBtn.length > 0) {
    console.log('Clicking enqueue button...');
    await enqueueBtn[0].click();
  }
  
  await new Promise(r=>setTimeout(r, 2000));

  await browser.close();
})().catch(console.error);
