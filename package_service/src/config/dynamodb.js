
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");

const clientConfig = {
    region: process.env.AWS_REGION || "us-east-1"
};


if (process.env.DYNAMODB_ENDPOINT) {
    clientConfig.endpoint = process.env.DYNAMODB_ENDPOINT;

    clientConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test"
    };
}

const client = new DynamoDBClient(clientConfig);

const dynamodb = DynamoDBDocumentClient.from(client);

module.exports = dynamodb;
