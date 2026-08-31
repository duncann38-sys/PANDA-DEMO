import { Actor } from "apify";
import { chromium } from "playwright";

const START_URL = "https://www.bokabord.se/restauranger/stockholm";
const CARD_SELECTOR = 'a[href*="/restaurang/"]';
const MAX_PAGES = 20;
const MAX_RESULTS = 750;
const CUISINES = new Set(
  [
    "Afrikanskt", "Amerikanskt", "Asiatiskt", "Brittiskt",
    "Centraleuropeiskt", "Franskt", "Grekiskt", "Internationellt",
    "Italienskt", "Japanskt", "Kinesiskt", "Koreanskt", "Libanesiskt",
    "Mexikanskt", "Nordiskt", "Palestinskt", "Persiskt", "Spanskt",
    "Svenskt", "Sydamerikanskt", "Sydeuropeiskt", "Thailändskt",
    "Tyskt", "Ukrainskt", "Vietnamesiskt",
  ].map((value) => value.toLocaleLowerCase("sv-SE")),
);

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

function boundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(1, parsed))
    : fallback;
}

function listingPageUrl(startUrl, pageNumber) {
  const url = new URL(startUrl);
  if (pageNumber === 1) url.searchParams.delete("paged");
  else url.searchParams.set("paged", String(pageNumber));
  return url.href;
}

function bookingId(bookingUrl) {
  const slug = new URL(bookingUrl).pathname.split("/").filter(Boolean).at(-1);
  return slug ? `bokabord:${slug}` : "";
}

async function extractListings(page) {
  const rows = await page.locator(CARD_SELECTOR).evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      bookingUrl: anchor.href,
      name:
        anchor.querySelector("p.font-medium")?.textContent ||
        anchor.querySelector("img[alt]")?.getAttribute("alt") ||
        "",
      address:
        anchor.querySelector("p.opacity-60")?.textContent ||
        anchor.querySelector("p + p")?.textContent ||
        "",
      tags: Array.from(
        anchor.querySelectorAll('[class*="whitespace-nowrap"]'),
      ).map((node) => node.textContent || ""),
      image:
        anchor.querySelector('img[class*="object-cover"]')?.getAttribute("src") ||
        "",
    })),
  );

  return rows
    .map((row) => {
      const tags = row.tags.map(clean).filter(Boolean);
      const bookingUrl = new URL(row.bookingUrl, page.url()).href;
      return {
        id: bookingId(bookingUrl),
        name: clean(row.name),
        cuisine:
          tags.find((tag) =>
            CUISINES.has(tag.toLocaleLowerCase("sv-SE")),
          ) || "",
        address: clean(row.address),
        bookingUrl,
        city: "Stockholm",
        provider: "bokabord",
        source: "bokabord.se",
        image: clean(row.image),
        timeSlots: [],
        menuUrl: null,
      };
    })
    .filter(
      (venue) =>
        venue.name &&
        venue.address &&
        /^https:\/\/www\.bokabord\.se\/restaurang\/[^/?#]+/i.test(
          venue.bookingUrl,
        ),
    );
}

await Actor.init();
let browser;
try {
  const input = (await Actor.getInput()) || {};
  const startUrl = clean(input.startUrl) || START_URL;
  const parsedStartUrl = new URL(startUrl);
  if (
    parsedStartUrl.hostname !== "www.bokabord.se" ||
    parsedStartUrl.pathname !== "/restauranger/stockholm"
  ) {
    throw new Error("Only the official Bokabord Stockholm listing is allowed.");
  }

  const maxPages = boundedInteger(input.maxPages, MAX_PAGES, MAX_PAGES);
  const maxResults = boundedInteger(input.maxResults, MAX_RESULTS, MAX_RESULTS);
  const proxyConfiguration = input.proxyConfiguration
    ? await Actor.createProxyConfiguration(input.proxyConfiguration)
    : null;
  const proxyUrl = proxyConfiguration
    ? await proxyConfiguration.newUrl()
    : null;
  const parsedProxy = proxyUrl ? new URL(proxyUrl) : null;

  browser = await chromium.launch({
    headless: true,
    proxy: parsedProxy
      ? {
          server: `${parsedProxy.protocol}//${parsedProxy.host}`,
          username: decodeURIComponent(parsedProxy.username),
          password: decodeURIComponent(parsedProxy.password),
        }
      : undefined,
  });
  const venues = [];
  const seen = new Set();
  let fullPageSize = 0;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    let pageVenues;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const page = await browser.newPage({ locale: "sv-SE" });
      page.setDefaultTimeout(30_000);
      try {
        const response = await page.goto(
          listingPageUrl(startUrl, pageNumber),
          {
            waitUntil: "domcontentloaded",
            timeout: 60_000,
          },
        );
        if (!response?.ok()) {
          throw new Error(
            `Bokabord page ${pageNumber} returned ${response?.status() || "no response"}.`,
          );
        }
        await page.waitForSelector(CARD_SELECTOR);
        await page.waitForTimeout(500);
        pageVenues = await extractListings(page);
        break;
      } catch (error) {
        lastError = error;
        console.warn(
          `Bokabord page ${pageNumber} attempt ${attempt} failed: ${error.message}`,
        );
      } finally {
        await page.close().catch(() => {});
      }
    }
    if (!pageVenues) throw lastError;
    if (pageNumber === 1) fullPageSize = pageVenues.length;
    let added = 0;
    for (const venue of pageVenues) {
      const key = venue.bookingUrl.toLowerCase().replace(/\/+$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      venues.push(venue);
      added += 1;
      if (venues.length >= maxResults) break;
    }
    console.log(
      `Bokabord page ${pageNumber}: ${pageVenues.length} found, ${added} new.`,
    );
    if (
      !pageVenues.length ||
      !added ||
      venues.length >= maxResults ||
      (fullPageSize && pageVenues.length < fullPageSize)
    ) {
      break;
    }
  }

  if (!venues.length) throw new Error("Bokabord returned no Stockholm venues.");
  await Actor.pushData(venues);
  console.log(`Saved ${venues.length} Bokabord Stockholm venues.`);
} finally {
  await browser?.close();
}
await Actor.exit();