
const { ApifyClient } = require('apify-client');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

// Fresh future date each run so neighbourhood search URLs never go stale.
function futureDateTime() {
  const d = new Date();
  d.setHours(19, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T19:00:00`;
}

// A self-refreshing OpenTable neighbourhood search URL from lat/lng.
function areaUrl(name, lat, lng) {
  const params = new URLSearchParams({
    dateTime: futureDateTime(),
    covers: '2',
    latitude: String(lat),
    longitude: String(lng),
    searchCenterType: 'neighborhood',
    searchedLocationName: name,
    shouldUseLatLongSearch: 'false',
    originCorrelationId: crypto.randomUUID()
  });
  return `https://www.opentable.co.uk/s?${params.toString()}`;
}

// Each area is scraped SEPARATELY so every borough is guaranteed its own pull.
const AREAS = [
  { label: 'Central London', url: 'https://www.opentable.co.uk/london-restaurants',        want: 1000 },
  { label: 'Battersea',      url: areaUrl('Battersea',  51.4730, -0.1541),                 want: 200 },
  { label: 'Nine Elms',      url: areaUrl('Nine Elms',  51.4800, -0.1300),                 want: 200 },
  { label: 'Chelsea',        url: areaUrl('Chelsea',    51.4883, -0.1697),                 want: 200 },
  { label: 'Fulham',         url: areaUrl('Fulham',     51.4778, -0.2047),                 want: 200 },
  { label: 'Clapham',        url: areaUrl('Clapham',    51.4620, -0.1380),                 want: 200 },
  { label: 'Victoria',       url: 'https://www.opentable.co.uk/landmark/restaurants-near-victoria-station', want: 200 }
];

async function scrapeArea(area) {
  try {
    console.log(`\n--- Scraping ${area.label} ---`);
    const run = await client.actor('shahidirfan/opentable-scraper').call({
      startUrls: [{ url: area.url }],
      results_wanted: area.want,
      max_pages: 25,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] }
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`${area.label}: ${items.length} raw results`);
    return items;
  } catch (err) {
    console.error(`${area.label} failed (skipping):`, err.message);
    return []; // one area failing must not break the whole file
  }
}

async function run() {
  try {
    console.log('Fetching live venue data from Apify per area (shahidirfan/opentable-scraper)...');

    // Run all areas in parallel, then merge.
    const results = await Promise.all(AREAS.map(scrapeArea));
    const allItems = results.flat();

    const seen = new Set();
    const processedVenues = [];
    for (const item of allItems) {
      if (!item || !item.name) continue;
      const key = String(item.restaurantId || item.id || item.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      processedVenues.push({
        id: item.restaurantId || item.id,
        name: item.name,
        address: item.address || '',
        cuisine: item.cuisine || '',
        rating: item.rating || null,
        reviewCount: item.reviewCount || null,
        image: item.profileImage || '',
        phone: item.phoneNumber || '',
        timeSlots: [],
        bookingUrl: item.url || '',
        menuUrl: null
      });
    }

    const outputPath = path.join(process.cwd(), 'venues.json');
    fs.writeFileSync(outputPath, JSON.stringify(processedVenues, null, 2));
    console.log(`\nSaved ${processedVenues.length} unique venues to ${outputPath}`);
    if (processedVenues[0]) {
      console.log('Sample venue:', JSON.stringify(processedVenues[0], null, 2));
    }
  } catch (error) {
    console.error('Error fetching data from Apify:', error);
    process.exit(1);
  }
}

run();
