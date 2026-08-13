const { ApifyClient } = require('apify-client');
const fs = require('fs');
const path = require('path');

const client = new ApifyClient({
    token: process.env.APIFY_API_TOKEN,
});

async function run() {
    try {
        console.log('Fetching live venue data from Apify...');

        const run = await client.actor("canadesk/opentable").call({
            search: "London",
            maxItems: 20
        });

        console.log(`Actor run finished. Fetching dataset items from: ${run.defaultDatasetId}`);
        
        const { items } = await client.dataset(run.defaultDatasetId).listItems();

        const processedVenues = items.map(item => ({
            id: item.id || item.restaurantId,
            name: item.name,
            location: item.location || item.address,
            cuisine: item.cuisine,
            image: item.image || item.photoUrl,
            slots: item.timeSlots || item.availability || [],
            bookingUrl: item.url || item.bookingLink,
            menuUrl: item.menuUrl || null
        }));

        const outputPath = path.join(process.cwd(), 'public', 'venues.json');
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(processedVenues, null, 2));
        console.log(`Successfully updated venue data! Saved ${processedVenues.length} venues to ${outputPath}`);

    } catch (error) {
        console.error('Error fetching data from Apify:', error);
        process.exit(1);
    }
}

run();
