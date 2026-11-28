const {
    ScanCommand,
    PutCommand
} = require("@aws-sdk/lib-dynamodb");

const dynamodb = require("../config/dynamodb");

const TABLE_NAME = process.env.DYNAMODB_TABLE || "Packages";

const samplePackages = [
    {
        packageId: "11111111-1111-4111-8111-111111111111",
        title: "Giza Pyramids Adventure",
        destination: "Giza",
        itinerary: ["Visit the Great Pyramids", "Explore the Sphinx"],
        startDate: "2026-12-10",
        endDate: "2026-12-12",
        price: 600,
        totalSeats: 20,
        seatsLeft: 20,
        isPublished: true
    },
    {
        packageId: "22222222-2222-4222-8222-222222222222",
        title: "Alexandria Weekend",
        destination: "Alexandria",
        itinerary: ["Visit the Citadel of Qaitbay", "Explore the Alexandria Library"],
        startDate: "2026-12-20",
        endDate: "2026-12-22",
        price: 1250,
        totalSeats: 30,
        seatsLeft: 30,
        isPublished: true
    },
    {
        packageId: "33333333-3333-4333-8333-333333333333",
        title: "Cairo City Adventure",
        destination: "Cairo",
        itinerary: ["Visit Cairo Tower", "Explore the Egyptian Museum"],
        startDate: "2027-01-10",
        endDate: "2027-01-12",
        price: 1000,
        totalSeats: 15,
        seatsLeft: 15,
        isPublished: false
    }
];

async function seedPackages() {
    const result = await dynamodb.send(
        new ScanCommand({
            TableName: TABLE_NAME
        })
    );

    const existingPackages = new Set(
        (result.Items || []).map(
            item => `${item.title}::${item.destination}`
        )
    );

    let inserted = 0;
    let skipped = 0;

    for (const sample of samplePackages) {
        const packageKey = `${sample.title}::${sample.destination}`;

        if (existingPackages.has(packageKey)) {
            console.log(`Skipped (already exists): ${sample.title}`);
            skipped++;
            continue;
        }

        try {
            await dynamodb.send(
                new PutCommand({
                    TableName: TABLE_NAME,
                    Item: sample,
                    ConditionExpression: "attribute_not_exists(packageId)"
                })
            );

            console.log(`Inserted: ${sample.title}`);
            inserted++;
        } catch (error) {
            if (error.name === "ConditionalCheckFailedException") {
                console.log(`Skipped (ID already exists): ${sample.title}`);
                skipped++;
                continue;
            }

            throw error;
        }
    }

    console.log("\nSeed completed!");
    console.log(`Inserted: ${inserted}`);
    console.log(`Skipped: ${skipped}`);
}

seedPackages().catch(error => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
});