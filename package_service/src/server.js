
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const packageRoutes = require("./routes/packageRoutes");
const pool = require("./config/db");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({ message: "The package server is running" });
});

app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT NOW()");
        res.status(200).json({
            status: "OK",
            database: "Connected"
        });
    } catch (error) {
        res.status(500).json({
            status: "Error",
            database: "Disconnected"
        });
    }
});

app.use("/packages", packageRoutes);

// Start the server locally only.
if (require.main === module) {
    const PORT = process.env.PORT || 3001;

    app.listen(PORT, () => {
        console.log(`The package service is running on port ${PORT}`);
    });
}

module.exports = app;
