/**
 * Flight Price API - Stable Version
 *
 * Uses Playwright locators for stable scraping
 * Captures Best and Cheapest tabs, applies filtering and scoring
 */

const express = require('express');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;

// Performance: timing helper
function mkTimer(label) {
  const t0 = Date.now();
  return (msg) => console.log(`[TIMER] ${label} ${msg} +${Date.now() - t0}ms`);
}

// Config
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// Helper: parse duration to minutes
function parseDurationToMinutes(text) {
  if (!text) return null;
  const match = text.match(/(\d+)\s*hr(?:s)?\s*(\d+)?\s*min(?:s)?/i);
  if (match) {
    const hours = parseInt(match[1]) || 0;
    const mins = parseInt(match[2]) || 0;
    return hours * 60 + mins;
  }
  // Just hours
  const hrMatch = text.match(/(\d+)\s*hr(?:s)?/i);
  if (hrMatch) return parseInt(hrMatch[1]) * 60;
  return null;
}

// Helper: extract price value
function extractPriceValue(text) {
  if (!text) return null;
  const match = text.match(/CA\$\s?([\d,]+)/);
  if (match) return parseInt(match[1].replace(/,/g, ''));
  // Try other currencies
  const usdMatch = text.match(/\$\s?([\d,]+)/);
  if (usdMatch) return parseInt(usdMatch[1].replace(/,/g, ''));
  return null;
}

// Helper: compute score
function computeScore(flight, options) {
  const {
    stopsPenalty = 220,
    durationPenaltyPerHour = 35,
    preferAirlines = [],
    airlineBias = 150,
    preferDepartWindow,
    avoidDepartWindow,
    timeBias = 120
  } = options;

  const base = flight.totalPrice;
  let stopsPenaltyTotal = stopsPenalty * flight.stops;

  const durationHours = flight.durationMinutes ? flight.durationMinutes / 60 : 0;
  const durationPenalty = durationPenaltyPerHour * Math.max(0, durationHours - 15);

  // Extension 2: preferAirlines - soft scoring (reduce score if preferred)
  let airlineBonus = 0;
  if (preferAirlines.length > 0 && flight.airlinesText) {
    const isPreferred = preferAirlines.some(airline =>
      flight.airlinesText.toLowerCase().includes(airline.toLowerCase())
    );
    if (isPreferred) {
      airlineBonus = airlineBias;
    }
  }

  // Extension 3: time window scoring
  let timePenalty = 0;
  if (preferDepartWindow || avoidDepartWindow) {
    const departMinutes = parseTimeToMinutes(flight.times?.[0]);
    if (departMinutes !== null) {
      if (preferDepartWindow) {
        const window = parseWindow(preferDepartWindow);
        if (window && isTimeInWindow(departMinutes, window[0], window[1])) {
          timePenalty -= timeBias; // Reduce score (good)
        }
      }
      if (avoidDepartWindow) {
        const window = parseWindow(avoidDepartWindow);
        if (window && isTimeInWindow(departMinutes, window[0], window[1])) {
          timePenalty += timeBias; // Increase score (bad)
        }
      }
    }
  }

  const score = base + stopsPenaltyTotal + durationPenalty + timePenalty - airlineBonus;

  return {
    score,
    breakdown: {
      base,
      stopsPenalty: stopsPenaltyTotal,
      durationPenalty: Math.round(durationPenalty),
      timePenalty: Math.round(timePenalty),
      airlineBonus
    }
  };
}

// Helper: check filters
function passesFilters(flight, options) {
  const { maxStops = 1, maxDurationHours = 26, avoidAirports = [], avoidAirlines = [], strictTime = false,
    preferDepartWindow, avoidDepartWindow } = options;

  if (flight.stops > maxStops) return false;
  if (flight.durationMinutes && flight.durationMinutes / 60 > maxDurationHours) return false;

  // Extension 1: avoidAirports - hard filter
  if (avoidAirports.length > 0 && flight.layoverAirports) {
    const hasAvoided = flight.layoverAirports.some(airport => avoidAirports.includes(airport));
    if (hasAvoided) return false;
  }

  // Extension 2: avoidAirlines - hard filter
  if (avoidAirlines.length > 0 && flight.airlinesText) {
    const hasAvoided = avoidAirlines.some(airline =>
      flight.airlinesText.toLowerCase().includes(airline.toLowerCase())
    );
    if (hasAvoided) return false;
  }

  // Extension 3: strictTime - avoid window filter
  if (strictTime && (preferDepartWindow || avoidDepartWindow)) {
    const departMinutes = parseTimeToMinutes(flight.times?.[0]);
    if (departMinutes !== null) {
      if (avoidDepartWindow) {
        const window = parseWindow(avoidDepartWindow);
        if (window && isTimeInWindow(departMinutes, window[0], window[1])) {
          return false;
        }
      }
    }
  }

  return true;
}

// Helper: parse time string to minutes (e.g., "6:30 AM" -> 390)
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;

  let hours = parseInt(match[1]);
  const mins = parseInt(match[2]);
  const period = match[3].toUpperCase();

  // Validate 12-hour format
  if (hours > 12 || hours < 1) return null;

  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  return hours * 60 + mins;
}

// Helper: parse window string to minutes (e.g., "15:00-23:59" -> [900, 1439])
function parseWindow(windowStr) {
  if (!windowStr) return null;
  const match = windowStr.match(/(\d{1,2}):(\d{1,2})\s*-\s*(\d{1,2}):(\d{1,2})/);
  if (!match) return null;

  const startMins = parseInt(match[1]) * 60 + parseInt(match[2]);
  const endMins = parseInt(match[3]) * 60 + parseInt(match[4]);
  return [startMins, endMins];
}

// Helper: check if time is in window
function isTimeInWindow(timeMins, startMins, endMins) {
  if (startMins <= endMins) {
    return timeMins >= startMins && timeMins <= endMins;
  } else {
    // Window crosses midnight
    return timeMins >= startMins || timeMins <= endMins;
  }
}

// Helper: scrape a single card - optimized with regex from cached textContent
async function scrapeCard(cardLocator, tabName) {
  try {
    // Get all text once - this is the main optimization
    const cardText = await cardLocator.textContent().catch(() => '');
    if (cardText.length < 30) return null;

    // Skip self-transfer
    if (cardText.toLowerCase().includes('self transfer')) return null;

    // Extract price - use regex from cached text (much faster than locator)
    let totalPrice = null;
    let priceText = '';
    const priceMatch = cardText.match(/CA\$\s?([\d,]+)/) || cardText.match(/\$\s?([\d,]+)/);
    if (priceMatch) {
      priceText = priceMatch[0];
      totalPrice = extractPriceValue(priceText);
    }
    if (!totalPrice) return null;

    // Extract times - all from cached text
    const timeMatches = cardText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)(?:\+\d+)?)/gi) || [];
    const departureTime = timeMatches[0] || '';
    let arrivalTime = '';
    let arrivalDayOffset = 0;
    // Find arrival time - look for the last time or one with +N
    if (timeMatches.length >= 2) {
      // Last time is usually arrival
      const rawTime = timeMatches[timeMatches.length - 1];
      const offsetMatch = rawTime.match(/\+(\d+)$/);
      if (offsetMatch) {
        arrivalDayOffset = parseInt(offsetMatch[1]) || 0;
        arrivalTime = rawTime.replace(/\+\d+$/, '').trim();
      } else {
        arrivalTime = rawTime;
      }
    }

    // Extract duration - from cached text
    let durationMinutes = null;
    const durMatch = cardText.match(/(\d+)\s*hr(?:s)?\s*(\d+)?\s*min/i);
    if (durMatch) {
      durationMinutes = (parseInt(durMatch[1]) || 0) * 60 + (parseInt(durMatch[2]) || 0);
    } else {
      const hrOnly = cardText.match(/(\d+)\s*hr(?:s)?/i);
      if (hrOnly) durationMinutes = parseInt(hrOnly[1]) * 60;
    }

    // Extract stops - from cached text
    let stops = 0;
    const stopsMatch = cardText.match(/(\d+)\s*stop/i);
    if (stopsMatch) {
      stops = parseInt(stopsMatch[1]);
    } else if (cardText.toLowerCase().includes('nonstop') || cardText.toLowerCase().includes('non-stop')) {
      stops = 0;
    }

    // Extract layover airports - find codes after "stop" keyword (more reliable)
    const layoverAirports = [];
    if (stops > 0) {
      // Find text after "stop" - this is where layover info is
      const stopIdx = cardText.toLowerCase().indexOf('stop');
      if (stopIdx >= 0) {
        const afterStop = cardText.slice(stopIdx, stopIdx + 60);
        // Match 3-letter codes that follow "stop" area
        const allCodes = (afterStop.match(/(?:^|[\s\-–—.,:])[A-Z]{3}(?=[A-Z\s]|$)/g) || []);

        const exclude = new Set([
          'USD','CAD','AM','PM','HR','MIN','NON','STO','STOP','AIR','JET','FLY','BUS','CAR',
          'TAR','ULA','ENA','TPE','TSA'
        ]);

        const cleanedCodes = allCodes.map(c => c.replace(/^[\s\-–—.,:]+/, '').trim()).filter(c => c && !exclude.has(c));

        // Best-effort: take the first N codes as layovers.
        for (const c of cleanedCodes) {
          layoverAirports.push(c);
          if (layoverAirports.length >= stops) break;
        }
      }
    }

    // Extract airlines - from cached text
    let airlinesText = '';
    const airlinePatterns = [
      /(American Airlines|United|Air Canada|Delta|China Eastern|China Southern|Air China|Singapore Airlines|Japan Airlines|Lufthansa|British Airways|WestJet|T'Way Air|Asiana|ANA|Korean Air|Qatar Airways|EVA Air|Emirates|Turkish Airlines)/gi
    ];
    for (const pattern of airlinePatterns) {
      const matches = cardText.match(pattern);
      if (matches) {
        airlinesText = [...new Set(matches)].join(', ');
        break;
      }
    }

    // Return times as [departureTime, arrivalTime] only (clean, without +N)
    const times = [departureTime, arrivalTime].filter(Boolean);

    // Determine currency from price text
    let currency = 'CAD';
    if (priceText) {
      if (priceText.startsWith('CA$')) currency = 'CAD';
      else if (priceText.startsWith('$')) currency = 'USD';
    }

    return {
      totalPrice,
      priceText,
      currency,
      durationMinutes,
      durationText: '',
      stops,
      layoverAirports,
      airlinesText,
      times,
      arrivalDayOffset,
      sourceTab: tabName
    };
  } catch (e) {
    console.log(`[scrapeCard] Error: ${e.message}`);
    return null;
  }
}

// Helper: simple hash for fingerprinting
function simpleHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) * 16777619;
  }
  return h >>> 0;
}

// Helper: get first card fingerprint (language-independent)
async function getFirstCardFingerprint(page) {
  try {
    return await page.evaluate(() => {
      // Find flight cards - look for elements containing price info
      const cards = Array.from(document.querySelectorAll('ul[role="list"] > li, div[role="listitem"], .z2KMD'));
      // Find first card that has price info (CA$ or $)
      const card = cards.find(c => (c.textContent || '').includes('CA$') || c.textContent?.includes('$'));
      if (!card) return { ok: false, text: '' };
      const text = (card.textContent || '').trim().slice(0, 400);
      // Only accept text with meaningful content (at least 50 chars)
      return text.length >= 50 ? { ok: true, text } : { ok: false, text };
    });
  } catch (e) {
    return { ok: false, text: '' };
  }
}

// Helper: wait for fingerprint to change
async function waitForFingerprintChange(page, beforeText, timeoutMs = 15000) {
  const t0 = Date.now();
  const beforeHash = simpleHash(beforeText);

  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(800).catch(() => {});
    const cur = await getFirstCardFingerprint(page);
    // Only compare if we have valid text
    if (cur.ok) {
      const currentHash = simpleHash(cur.text);
      if (currentHash !== beforeHash) {
        return { changed: true };
      }
    }
  }
  return { changed: false };
}

// Helper: scrape a single tab
async function scrapeTab(page, tabName, options = {}) {
  const { topN = 8 } = options;
  const results = [];
  let tabClicked = false;
  const timer = mkTimer(`scrapeTab(${tabName})`);

  // Capture fingerprint BEFORE clicking (for comparison after refresh)
  // This is captured at the START of scrapeTab - before any click happens
  let beforeFingerprint = null;
  if (tabName !== 'Best') {
    // Quick check - just get fingerprint if available (no extra waiting)
    const fp = await getFirstCardFingerprint(page);
    if (fp.ok) {
      beforeFingerprint = fp.text;
    }
  }

  try {
    timer('start');
    // Try to click the tab using getByRole for more precise selection
    const tab = page.getByRole('tab', { name: new RegExp(`^${tabName}\\b`, 'i') }).first();

    if (await tab.isVisible().catch(() => false)) {
      // Try clicking + keyboard navigation for reliable tab switch
      try {
        // First click to focus
        await tab.click().catch(() => {});
        await new Promise(r => setTimeout(r, 500)).catch(() => {});

        // Use keyboard to navigate to the correct tab
        if (tabName === 'Cheapest') {
          // Press Tab to focus on tablist, then ArrowRight to switch
          await page.keyboard.press('Tab').catch(() => {});
          await new Promise(r => setTimeout(r, 200)).catch(() => {});
          await page.keyboard.press('ArrowRight').catch(() => {});
          await new Promise(r => setTimeout(r, 200)).catch(() => {});
          await page.keyboard.press('ArrowRight').catch(() => {});
          await new Promise(r => setTimeout(r, 200)).catch(() => {});
        }
      } catch (e) {
        // Fallback to click
        await tab.click().catch(() => {});
      }

      tabClicked = true;
      timer('tab clicked');

      // Wait for loading indicator to appear, then disappear (data refresh)
      const loadingSelectors = [
        'text=Checking online travel agencies',
        'text=Checking alternative dates',
        '.sh-dialog-container',  // Loading dialog
        '[role="progressbar"]', // Material progress bar
        'div[aria-label*="Loading"]'
      ];

      // First, wait a bit for loading to potentially start
      await new Promise(r => setTimeout(r, 500)).catch(() => {});

      // Wait for loading to complete (loading indicators disappear)
      for (const sel of loadingSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 2000 }).catch(() => {});
          // Loading indicator found - wait for it to disappear
          await page.waitForSelector(sel, { state: 'hidden', timeout: 30000 }).catch(() => {});
          timer('loading complete');
          break;
        } catch (e) {
          // This selector didn't match, try next one
        }
      }

      // Wait for cards to be present
      await page.waitForSelector('ul[role="list"] > li, div[role="listitem"], .z2KMD', { timeout: 8000 }).catch(() => {});
      timer('cards ready');

      // Additional stabilization wait - let DOM settle after loading
      // This is critical: sometimes loading indicator disappears but data hasn't refreshed yet
      if (tabClicked) {
        // Force a small scroll to trigger any lazy-loaded content
        await page.evaluate(() => window.scrollBy(0, 50)).catch(() => {});
        await new Promise(r => setTimeout(r, 500)).catch(() => {});

        // === Fingerprint verification: wait for data to actually change ===
        if (beforeFingerprint && tabName !== 'Best') {
          const fpResult = await waitForFingerprintChange(page, beforeFingerprint, 15000);
          if (fpResult.changed) {
            console.log(`[scrapeTab] ${tabName}: Data refreshed!`);
          } else {
            console.log(`[scrapeTab] ${tabName}: WARNING - Data may not have refreshed`);
          }
        } else if (!beforeFingerprint && tabName !== 'Best') {
          console.log(`[scrapeTab] ${tabName}: Could not capture beforeFingerprint`);
        }

        timer('dom stabilized');
      }
    }
  } catch (e) {
    console.log(`[scrapeTab] Could not click ${tabName} tab:`, e.message);
  }

  // Get a sample of the current card data to verify it's fresh
  let sampleData = null;
  try {
    sampleData = await page.evaluate(() => {
      const card = document.querySelector('.pIav2d, ul[role="list"] > li');
      if (!card) return null;
      const text = card.textContent || '';
      // Get first 200 chars as sample
      return text.substring(0, 200);
    }).catch(() => null);
  } catch (e) {
    console.log(`[scrapeTab] ${tabName}: Could not get sample data: ${e.message}`);
  }

  if (sampleData) {
    console.log(`[scrapeTab] ${tabName}: Verified data present (${sampleData.substring(0, 50)}...)`);
  }

  timer('before screenshot');

  // Take screenshot with error handling - browser may have closed
  let screenshotPath = '';
  try {
    const timestamp = Date.now();
    screenshotPath = path.join(SCREENSHOTS_DIR, `${tabName}_${timestamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
  } catch (screenshotErr) {
    console.log(`[scrapeTab] ${tabName}: Screenshot failed: ${screenshotErr.message}`);
    screenshotPath = '';
  }

  // Find flight cards locator - use prioritized selectors
  const cardSelectors = [
    'ul[role="list"] > li',
    '.z2KMD',
    'div[role="listitem"]'
  ];

  let cardsLocator = null;
  let cardCount = 0;

  try {
    for (const sel of cardSelectors) {
      const locator = page.locator(sel);
      const count = await locator.count();
      if (count > 0) {
        cardsLocator = locator;
        cardCount = count;
        break;
      }
    }
  } catch (locatorErr) {
    console.log(`[scrapeTab] ${tabName}: Error finding cards: ${locatorErr.message}`);
  }

  if (!cardsLocator) {
    return { results: [], tabClicked, screenshotPath: path.basename(screenshotPath || ''), count: 0 };
  }
  timer(`found ${cardCount} cards`);

  // Extract data from each card using locator + nth with scanLimit + early break
  const scanLimit = Math.min(cardCount, topN * 4);
  timer(`scanning up to ${scanLimit} cards`);
  try {
    for (let i = 0; i < scanLimit; i++) {
      const cardLocator = cardsLocator.nth(i);
      const flight = await scrapeCard(cardLocator, tabName);
      if (flight) {
        results.push(flight);
      }
      // Early break when we have enough results
      if (results.length >= topN) break;
    }
  } catch (scrapeErr) {
    console.log(`[scrapeTab] ${tabName}: Error during card scraping: ${scrapeErr.message}`);
  }
  timer(`scanned ${scanLimit} cards, got ${results.length} flights`);

  console.log(`[scrapeTab] Extracted ${results.length} flights from ${scanLimit} scanned cards (total cards=${cardCount})`);

  return {
    results,
    tabClicked,
    screenshotPath: screenshotPath ? path.basename(screenshotPath) : '',
    count: results.length
  };
}

// Main function
async function searchFlights(params) {
  const {
    from,
    to,
    depart,
    return: returnDate,
    topBest = 8,
    topCheapest = 8,
    maxStops = 1,
    maxDurationHours = 26,
    stopsPenalty = 220,
    durationPenaltyPerHour = 35,
    mode = 'both',
    headless = false,
    // Extension 1: avoidAirports
    avoidAirports = [],
    // Extension 2: prefer/avoidAirlines
    preferAirlines = [],
    avoidAirlines = [],
    airlineBias = 150,
    // Extension 3: timeWindows
    preferDepartWindow,
    avoidDepartWindow,
    timeBias = 120,
    strictTime = false
  } = params;

  // Parse comma-separated arrays
  const parsedAvoidAirports = Array.isArray(avoidAirports)
    ? avoidAirports
    : (typeof avoidAirports === 'string' ? avoidAirports.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : []);
  const parsedPreferAirlines = Array.isArray(preferAirlines)
    ? preferAirlines
    : (typeof preferAirlines === 'string' ? preferAirlines.split(',').map(s => s.trim()).filter(Boolean) : []);
  const parsedAvoidAirlines = Array.isArray(avoidAirlines)
    ? avoidAirlines
    : (typeof avoidAirlines === 'string' ? avoidAirlines.split(',').map(s => s.trim()).filter(Boolean) : []);

  console.log('[debug] before chromium.launch');
  const browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled']
  });
  console.log('[debug] after chromium.launch');

  // Use context for better browser fingerprinting
  const context = await browser.newContext({
    locale: 'en-CA',
    timezoneId: 'America/Toronto',
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  // Listen to browser console for debugging
  page.on('console', msg => console.log('[browser]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[browser:error]', err.message));

  // Set accept language
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9'
  });

  const diagnostics = {
    tabClicks: { best: false, cheapest: false },
    counts: { best: 0, cheapest: 0 },
    screenshots: {},
    capturedAt: new Date().toISOString()
  };

  let bestResult;
  let cheapestResult;
  let url;
  const timer = mkTimer('searchFlights');

  try {
    // Build URL
    const query = `flights from ${from} to ${to} ${depart} to ${returnDate}`;
    url = `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}&hl=en&gl=CA`;

    console.log(`[searchFlights] Loading: ${url}`);

    console.log('[debug] before goto');
    await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
    console.log('[debug] after goto');

    // Check for consent/banner and handle if present
    const consentVisible = await page.locator('text=/Before you continue|I agree|Accept all|Agree and continue/i').first().isVisible().catch(() => false);
    if (consentVisible) {
      console.log('[searchFlights] Consent banner detected, attempting to accept');
      await page.locator('text=/Accept all|I agree|Agree and continue|Continue/i').first().click().catch(() => {});
      await page.waitForTimeout(1500);
    }

    timer('page loaded');
    await page.waitForTimeout(2500); // Wait for dynamic content
    timer('content wait done');

    // Scrape Best tab
    if (mode === 'best' || mode === 'both') {
      bestResult = await scrapeTab(page, 'Best', { topN: topBest });
      diagnostics.tabClicks.best = bestResult.tabClicked;
      diagnostics.counts.best = bestResult.count;
      diagnostics.screenshots.best = bestResult.screenshotPath;
      console.log(`[searchFlights] Best tab: ${bestResult.count} flights`);
      timer('Best tab done');
    }

    // Scrape Cheapest tab
    if (mode === 'cheapest' || mode === 'both') {
      cheapestResult = await scrapeTab(page, 'Cheapest', { topN: topCheapest });
      diagnostics.tabClicks.cheapest = cheapestResult.tabClicked;
      diagnostics.counts.cheapest = cheapestResult.count;
      diagnostics.screenshots.cheapest = cheapestResult.screenshotPath;
      console.log(`[searchFlights] Cheapest tab: ${cheapestResult.count} flights`);
      timer('Cheapest tab done');
    }

  } finally {
    // Aggressive cleanup: close page first, then browser
    try { await page.close({ runBeforeUnload: false }); } catch (e) {}
    try { await browser.close(); } catch (e) {}
  }

  // Build raw results from captured data (with defensive initialization)
  const bestResultInit = bestResult || { results: [], count: 0 };
  const cheapestResultInit = cheapestResult || { results: [], count: 0 };

  const raw = {
    best: bestResultInit.results,
    cheapest: cheapestResultInit.results
  };

  // Merge and deduplicate
  const allFlights = [...raw.best, ...raw.cheapest];

  // Deduplicate by hash
  const seen = new Set();
  const deduped = [];
  for (const f of allFlights) {
    const hash = `${f.totalPrice}|${f.durationMinutes || 0}|${f.stops}|${f.airlinesText}`;
    if (!seen.has(hash)) {
      seen.add(hash);
      deduped.push(f);
    }
  }

  // Apply filters (including avoidAirports, avoidAirlines, strictTime)
  const filterOptions = {
    maxStops,
    maxDurationHours,
    avoidAirports: parsedAvoidAirports,
    avoidAirlines: parsedAvoidAirlines,
    preferDepartWindow,
    avoidDepartWindow,
    strictTime
  };
  const filtered = deduped.filter(f => passesFilters(f, filterOptions));

  // Track filtered counts (total filtered by all filters)
  const filteredTotal = deduped.length - filtered.length;

  // Compute scores (including preferAirlines, timeWindows)
  const scoreOptions = {
    stopsPenalty,
    durationPenaltyPerHour,
    preferAirlines: parsedPreferAirlines,
    airlineBias,
    preferDepartWindow,
    avoidDepartWindow,
    timeBias
  };
  const scored = filtered.map(f => {
    const scoreResult = computeScore(f, scoreOptions);
    return {
      ...f,
      score: scoreResult.score,
      scoreBreakdown: scoreResult.breakdown
    };
  });

  // Sort by score (lower is better)
  scored.sort((a, b) => a.score - b.score);

  const recommended = scored.slice(0, 10);

  timer('all done');

  // Extract currency from first flight (if available)
  const firstFlight = allFlights[0];
  const currencyDetected = firstFlight?.currency || 'CAD';

  // Top-level explainable fields
  const filtersApplied = {
    maxStops,
    maxDurationHours,
    avoidAirports: parsedAvoidAirports,
    avoidAirlines: parsedAvoidAirlines,
    preferAirlines: parsedPreferAirlines,
    preferDepartWindow,
    avoidDepartWindow,
    strictTime
  };

  const scoringConfig = {
    stopsPenalty,
    durationPenaltyPerHour,
    airlineBias,
    timeBias
  };

  return {
    success: true,
    query: { from, to, depart, return: returnDate },
    googleFlightsUrl: url,
    currencyDetected,
    recommended,
    raw: {
      best: raw.best,
      cheapest: raw.cheapest
    },
    filtersApplied,
    scoringConfig,
    diagnostics: {
      ...diagnostics,
      url,
      totalCollected: allFlights.length,
      afterDedup: deduped.length,
      afterFilter: filtered.length,
      filteredTotal,
      filtersApplied
    }
  };
}

// ============ API Routes ============

// GET /price - Main endpoint
app.get('/price', async (req, res) => {
  const {
    from, to, depart, return: ret,
    topBest, topCheapest,
    maxStops, maxDurationHours,
    stopsPenalty, durationPenaltyPerHour,
    mode,
    headless,
    // Extension 1: avoidAirports
    avoidAirports,
    // Extension 2: prefer/avoidAirlines
    preferAirlines, avoidAirlines, airlineBias,
    // Extension 3: timeWindows
    preferDepartWindow, avoidDepartWindow, timeBias, strictTime
  } = req.query;

  if (!from || !to || !depart || !ret) {
    return res.status(400).json({
      error: 'Missing required params: from, to, depart, return'
    });
  }

  console.log(`\n=== /price: ${from} → ${to} | ${depart} → ${ret} ===`);

  try {
    const result = await searchFlights({
      from,
      to,
      depart,
      return: ret,
      topBest: topBest ? parseInt(topBest) : undefined,
      topCheapest: topCheapest ? parseInt(topCheapest) : undefined,
      maxStops: maxStops ? parseInt(maxStops) : undefined,
      maxDurationHours: maxDurationHours ? parseInt(maxDurationHours) : undefined,
      stopsPenalty: stopsPenalty ? parseInt(stopsPenalty) : undefined,
      durationPenaltyPerHour: durationPenaltyPerHour ? parseInt(durationPenaltyPerHour) : undefined,
      mode,
      headless: headless === 'true' || headless === '1',
      // Extension 1: avoidAirports
      avoidAirports,
      // Extension 2: prefer/avoidAirlines
      preferAirlines,
      avoidAirlines,
      airlineBias: airlineBias ? parseInt(airlineBias) : undefined,
      // Extension 3: timeWindows
      preferDepartWindow,
      avoidDepartWindow,
      timeBias: timeBias ? parseInt(timeBias) : undefined,
      strictTime: strictTime === 'true' || strictTime === '1'
    });

    res.json(result);
  } catch (error) {
    console.error('[price] failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
      query: { from, to, depart, return: ret }
    });
  }
});

// GET /search - Reuse /price handler
app.get('/search', (req, res) => {
  req.url = '/price?' + req.url.split('?')[1];
  app._router.handle(req, res);
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    endpoints: ['/price', '/search'],
    screenshotsDir: SCREENSHOTS_DIR,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`
🚀 Flight Price API running on http://localhost:${PORT}

Usage:
  /price?from=Toronto&to=Shanghai&depart=2026-03-06&return=2026-03-22

  Parameters:
    topBest=8         - Number of results from Best tab
    topCheapest=8     - Number of results from Cheapest tab
    maxStops=1         - Maximum stops allowed
    maxDurationHours=26 - Maximum duration in hours
    stopsPenalty=220   - CAD penalty per stop
    durationPenaltyPerHour=35 - CAD penalty per hour over 15
    mode=both          - best|cheapest|both
    headless=true      - Run in headless mode

    -- Extension 1: avoidAirports --
    avoidAirports=PEK,DOH - Comma-separated airports to avoid

    -- Extension 2: prefer/avoidAirlines --
    preferAirlines=United,Air Canada - Comma-separated preferred airlines
    avoidAirlines=China Southern    - Comma-separated airlines to avoid
    airlineBias=150               - Score reduction for preferred airlines

    -- Extension 3: timeWindows --
    preferDepartWindow=15:00-23:59 - Preferred departure window
    avoidDepartWindow=00:00-06:00  - Avoid departure window
    timeBias=120                 - Score penalty/bonus for time preferences
    strictTime=true               - Filter out instead of penalize

  Screenshots saved to: ${SCREENSHOTS_DIR}
`);
});
