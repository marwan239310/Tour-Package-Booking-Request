const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { DescribeTableCommand } = require("@aws-sdk/client-dynamodb");
const dynamodb = require("./config/dynamodb");

const packageRoutes = require("./routes/packageRoutes");

const app = express();

app.disable("x-powered-by");

// ------------------------------------------
// CORS: only the team website may call the API from a browser.
// CORS_ORIGINS is a comma-separated list; "*" allows any origin.
// ------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGINS ||
    "http://localhost:4566,http://localhost:8080,http://127.0.0.1:5500,http://localhost:5500")
    .split(",")
    .map(origin => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        // Requests without an Origin header (curl, Postman, other services) are allowed;
        // CORS only protects browsers. Login is enforced on the staff routes.
        if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// ------------------------------------------
// Security headers on every answer
// ------------------------------------------
app.use((req, res, next) => {
    res.set({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "Cache-Control": "no-store"
    });
    next();
});

// ------------------------------------------
// Request log: one line per request (shows up in CloudWatch Logs on Lambda)
// ------------------------------------------
app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
        if (process.env.NODE_ENV === "test") return;
        console.log(`[package-service] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started} ms)`);
    });
    next();
});

app.use(express.json({ limit: "20kb" }));

app.get("/", (req, res) => {
    res.json({ message: "The package server is running" });
});

app.get("/health", async (req, res) => {
    const runtime = process.env.AWS_LAMBDA_FUNCTION_NAME ? "lambda" : "pc";

    try {
        await dynamodb.send(
            new DescribeTableCommand({
                TableName: process.env.DYNAMODB_TABLE || "Packages"
            })
        );

        res.status(200).json({
            status: "OK",
            database: "DynamoDB Connected",
            runtime
        });
    } catch (error) {
        console.error("DynamoDB health check failed:", error);

        res.status(500).json({
            status: "Error",
            database: "DynamoDB Disconnected",
            runtime
        });
    }
});

app.use("/packages", packageRoutes);

// Unknown routes answer JSON instead of an HTML page
app.use((req, res) => {
    res.status(404).json({ message: `Route ${req.method} ${req.path} not found` });
});

// Bad JSON, too-large bodies and unexpected errors answer JSON with a clear message
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
    if (error.type === "entity.parse.failed") {
        return res.status(400).json({ message: "Request body must be valid JSON" });
    }

    if (error.type === "entity.too.large") {
        return res.status(413).json({ message: "Request body is too large" });
    }

    console.error("[package-service] unexpected error:", error);
    return res.status(500).json({ message: "Something went wrong. Please try again later." });
});

if (require.main === module) {
    const PORT = process.env.PORT || 3001;

    app.listen(PORT, () => {
        console.log(`The package service is running on port ${PORT}`);
    });
}

module.exports = app;
