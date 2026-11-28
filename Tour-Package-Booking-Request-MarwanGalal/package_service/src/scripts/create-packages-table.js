
require("dotenv").config();

const {
    DynamoDBClient,
    DescribeTableCommand,
    CreateTableCommand,
    waitUntilTableExists
} = require("@aws-sdk/client-dynamodb");

const client = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
    endpoint: process.env.DYNAMODB_ENDPOINT || "http://localhost:4566",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test"
    }
});

const TABLE_NAME = "Packages";

async function createPackagesTable() {
    try {
        // Check whether the table already exists
        await client.send(
            new DescribeTableCommand({
                TableName: TABLE_NAME
            })
        );

        console.log(`Table "${TABLE_NAME}" already exists.`);
        return;

    } catch (error) {
        if (error.name !== "ResourceNotFoundException") {
            throw error;
        }
    }

    // Create the table if it does not exist
    await client.send(
        new CreateTableCommand({
            TableName: TABLE_NAME,
            KeySchema: [
                {
                    AttributeName: "packageId",
                    KeyType: "HASH"
                }
            ],
            AttributeDefinitions: [
                {
                    AttributeName: "packageId",
                    AttributeType: "S"
                }
            ],
            BillingMode: "PAY_PER_REQUEST"
        })
    );

    console.log("Packages table creation requested.");

    await waitUntilTableExists(
        { client, maxWaitTime: 60 },
        { TableName: TABLE_NAME }
    );

    console.log(`Table "${TABLE_NAME}" is ready.`);
}

createPackagesTable()
    .catch(error => {
        console.error("Error creating Packages table:", error);
        process.exitCode = 1;
    })
    .finally(() => client.destroy());
