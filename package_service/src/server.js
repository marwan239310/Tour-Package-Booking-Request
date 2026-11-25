
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { DescribeTableCommand } = require("@aws-sdk/client-dynamodb");
const dynamodb = require("./config/dynamodb");

const packageRoutes = require("./routes/packageRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({ message: "The package server is running" });
});

app.get("/health", async (req, res) => {
    try {
        await dynamodb.send(
            new DescribeTableCommand({
                TableName: "Packages"
            })
        );

        res.status(200).json({
            status: "OK",
            database: "DynamoDB Connected"
        });
    } catch (error) {
        console.error("DynamoDB health check failed:", error);

        res.status(500).json({
            status: "Error",
            database: "DynamoDB Disconnected"
        });
    }
});

app.use("/packages", packageRoutes);

if (require.main === module) {
    const PORT = process.env.PORT || 3001;

    app.listen(PORT, () => {
        console.log(`The package service is running on port ${PORT}`);
    });
}

module.exports = app;
