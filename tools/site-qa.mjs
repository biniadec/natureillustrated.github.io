import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.SITE_URL || 'http://127.0.0.1:8765/';
const outDir = path.resolve('tools/responsive-screenshots');

async function scrollPage(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = Math.max(320, Math.round(window.innerHeight * 0.7));
      const timer = setInterval(() => {
        y += step;
        window.scrollTo(0, y);
        if (y >= document.documentElement.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 80);
    });
  });
  await page.waitForTimeout(500);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const consoleMessages = [];
  const failedRequests = [];
  const badResponses = [];

  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });

  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.trim());
  });

  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) badResponses.push(`${status} ${response.url()}`);
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await scrollPage(page);

  const domReport = await page.evaluate(() => {
    const stylesheetOk = Array.from(document.styleSheets).some((sheet) => sheet.href?.endsWith('/styles.css'));
    const missingImages = Array.from(document.images)
      .filter((image) => !image.complete || image.naturalWidth === 0)
      .map((image) => image.currentSrc || image.src);
    const missingAlt = Array.from(document.images)
      .filter((image) => !image.hasAttribute('alt'))
      .map((image) => image.currentSrc || image.src);
    const internalLinks = Array.from(document.querySelectorAll('a[href^="#"]')).map((link) => ({
      href: link.getAttribute('href'),
      text: link.textContent.trim(),
    }));
    const brokenInternalLinks = internalLinks.filter((link) => link.href !== '#' && !document.querySelector(link.href));
    const touchTargets = Array.from(document.querySelectorAll('a, button'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 32);
      })
      .map((element) => ({
        text: element.textContent.trim() || element.getAttribute('aria-label') || element.tagName.toLowerCase(),
        width: Math.round(element.getBoundingClientRect().width),
        height: Math.round(element.getBoundingClientRect().height),
      }));
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map((heading) => ({
      level: Number(heading.tagName.slice(1)),
      text: heading.textContent.trim(),
    }));
    const icons = Array.from(document.querySelectorAll('svg use')).map((use) => use.getAttribute('href'));

    return {
      title: document.title,
      stylesheetOk,
      scriptOk: Boolean(window.NATURE_ILLUSTRATED_CONFIG),
      missingImages,
      missingAlt,
      brokenInternalLinks,
      touchTargets,
      headings,
      icons,
      formAction: document.querySelector('.contact-form')?.action,
    };
  });

  await page.setViewportSize({ width: 375, height: 667 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.nav-toggle').click();
  await page.waitForTimeout(500);
  const mobileNavLinks = await page.locator('.site-nav a').evaluateAll((links) =>
    links.map((link) => {
      const rect = link.getBoundingClientRect();
      return { text: link.textContent.trim(), top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
    }),
  );
  await page.screenshot({ path: path.join(outDir, 'qa-mobile-nav.png'), fullPage: false });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}#contact`, { waitUntil: 'networkidle' });
  await page.locator('.contact-form button[type="submit"]').click();
  const validationMessage = await page.locator('.contact-form input[name="name"]').evaluate((input) => input.validationMessage);

  await page.locator('.contact-form input[name="name"]').fill('Nature.Illustrated QA');
  await page.locator('.contact-form input[name="email"]').fill('qa-test@example.com');
  await page.locator('.contact-form select[name="project_type"]').selectOption({ label: 'Other' });
  await page.locator('.contact-form textarea[name="message"]').fill('Automated production QA test after website-v2 promotion. No reply needed.');

  let formStatus = '';
  let formSubmissionOk = false;
  try {
    await Promise.all([
      page.waitForResponse((response) => response.url().startsWith('https://formspree.io/f/mnjkpdqp'), { timeout: 20000 }),
      page.locator('.contact-form button[type="submit"]').click(),
    ]);
    await page.locator('.form-status:not([hidden])').waitFor({ timeout: 10000 });
    formStatus = await page.locator('.form-status').innerText();
    formSubmissionOk = /sent/i.test(formStatus);
  } catch (error) {
    formStatus = `Form submission check failed: ${error.message}`;
  }

  await browser.close();

  const report = {
    baseUrl,
    consoleMessages,
    failedRequests,
    badResponses,
    domReport,
    mobileNavLinks,
    contactForm: {
      endpointExpected: 'https://formspree.io/f/mnjkpdqp',
      endpointActual: domReport.formAction,
      validationMessage,
      formSubmissionOk,
      formStatus,
    },
  };

  await fs.writeFile(path.join(outDir, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));

  const failures = [
    ...consoleMessages,
    ...failedRequests,
    ...badResponses,
    ...domReport.missingImages,
    ...domReport.missingAlt,
    ...domReport.brokenInternalLinks.map((link) => `Broken internal link ${link.href}`),
  ];

  if (!domReport.stylesheetOk) failures.push('styles.css was not detected');
  if (!domReport.scriptOk) failures.push('site-config.js was not detected');
  if (domReport.formAction !== 'https://formspree.io/f/mnjkpdqp') failures.push('Unexpected Formspree endpoint');
  if (!validationMessage) failures.push('Required validation message did not appear');
  if (!formSubmissionOk) failures.push(formStatus);

  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
