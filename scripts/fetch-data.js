const { ApifyClient } = require('apify-client');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

// Build a fresh future date each run so neighbourhood search URLs never go stale.
function futureDateTime() {
  const d = new Date();
  d.setHours(19, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1); // if past 7pm, use tomorrow
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T19:00:00`;
}

// A stable (self-refreshing) OpenTable neighbourhood search URL from lat/lng.
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

async function run() {
  try {
    console.log('Fetching live venue data from Apify (shahidirfan/opentable-scraper)...');

    // City-wide (spans all neighbourhoods) + Victoria landmark + guaranteed areas.
    const startUrls = [
      { url: 'https://www.opentable.co.uk/london-restaurants' },
      { url: 'https://www.opentable.co.uk/landmark/restaurants-near-victoria-station' },
      { url: areaUrl('Battersea', 51.4730, -0.1541) },
      { url: areaUrl('Chelsea', 51.4883, -0.1697) },
      { url: areaUrl('Fulham', 51.4778, -0.2047) }
    ];

    const run = await client.actor('shahidirfan/opentable-scraper').call({
      startUrls,
      results_wanted: 500,
      max_pages: 10,
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL']
      }
    });

    console.log(`Actor run finished. Dataset: ${run.defaultDatasetId}`);
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    // De-duplicate across all the URLs by restaurant id / name.
    const seen = new Set();
    const processedVenues = [];
    for (const item of items) {
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
    console.log(`Saved ${processedVenues.length} venues to ${outputPath}`);
    if (processedVenues[0]) {
      console.log('Sample venue:', JSON.stringify(processedVenues[0], null, 2));
    }
  } catch (error) {
    console.error('Error fetching data from Apify:', error);
    process.exit(1);
  }
}

run();
