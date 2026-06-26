import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.SITE_URL || 'http://127.0.0.1:8765/';
const outDir = path.resolve('tools/responsive-screenshots');

const devices = [
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'laptop-1440', width: 1440, height: 900 },
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-15-pro', width: 393, height: 852 },
  { name: 'iphone-15-pro-max', width: 430, height: 932 },
  { name: 'ipad', width: 768, height: 1024 },
];

const sections = ['top', 'about', 'portfolio', 'shop', 'contact'];
const portfolioRows = [
  'scientific-illustration',
  'scientific-figures',
  'graphical-abstracts',
  'journal-covers',
  'thesis-covers',
  'logos-branding',
  'nature-art',
];

async function scrollTargetToTop(page, selector) {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!target) return;
    const headerHeight = document.querySelector('.site-header')?.getBoundingClientRect().height || 0;
    const y = target.getBoundingClientRect().top + window.scrollY - headerHeight;
    window.scrollTo(0, Math.max(0, y));
  }, selector);
  await page.waitForTimeout(300);
}

async function collectOverflow(page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const pageOverflow = Math.max(
      0,
      document.documentElement.scrollWidth - viewportWidth,
      document.body.scrollWidth - viewportWidth,
    );

    const offenders = Array.from(document.querySelectorAll('body *'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const overflowRight = Math.max(0, rect.right - viewportWidth);
        const overflowLeft = Math.max(0, -rect.left);
        return {
          selector:
            element.id ? `#${element.id}` :
              element.className && typeof element.className === 'string'
                ? `${element.tagName.toLowerCase()}.${element.className.trim().split(/\s+/).join('.')}`
                : element.tagName.toLowerCase(),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          overflow: Math.round(Math.max(overflowLeft, overflowRight)),
        };
      })
      .filter((item, index) => {
        const element = document.querySelectorAll('body *')[index];
        return !element?.closest?.('.site-nav');
      })
      .filter((item) => item.selector !== '#site-nav')
      .filter((item) => item.overflow > 1 && item.width > 0)
      .sort((a, b) => b.overflow - a.overflow)
      .slice(0, 12);

    return { viewportWidth, pageOverflow: Math.round(pageOverflow), offenders };
  });
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const report = [];

  for (const device of devices) {
    const page = await browser.newPage({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: 2,
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(350);

    const sectionShots = {};
    for (const section of sections) {
      const locator = page.locator(`#${section}`);
      if (await locator.count()) {
        await scrollTargetToTop(page, `#${section}`);
        const shotPath = path.join(outDir, `${device.name}-viewport-${section}.png`);
        await page.screenshot({ path: shotPath, fullPage: false });
        sectionShots[section] = shotPath;
      }
    }

    const footer = page.locator('.site-footer');
    await scrollTargetToTop(page, '.site-footer');
    sectionShots.footer = path.join(outDir, `${device.name}-viewport-footer.png`);
    await page.screenshot({ path: sectionShots.footer, fullPage: false });

    const rowShots = {};
    for (const row of portfolioRows) {
      await scrollTargetToTop(page, `#${row}`);
      const shotPath = path.join(outDir, `${device.name}-portfolio-${row}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });
      rowShots[row] = shotPath;
    }

    let navShot = null;
    await page.evaluate(() => window.scrollTo(0, 0));
    if (await page.locator('.nav-toggle').isVisible()) {
      await page.locator('.nav-toggle').click();
      await page.waitForTimeout(500);
      navShot = path.join(outDir, `${device.name}-viewport-nav-open.png`);
      await page.screenshot({ path: navShot, fullPage: false });
      await page.locator('.nav-toggle').click();
      await page.waitForTimeout(500);
    }

    const fullPagePath = path.join(outDir, `${device.name}-full.png`);
    await page.screenshot({ path: fullPagePath, fullPage: true });

    report.push({
      device,
      fullPagePath,
      sectionShots,
      rowShots,
      navShot,
      overflow: await collectOverflow(page),
    });

    await page.close();
  }

  await browser.close();
  await fs.writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.map(({ device, overflow }) => ({ device, overflow })), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
