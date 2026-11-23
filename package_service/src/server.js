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
app.use ("/packages", packageRoutes);
const PORT = process.env.PORT || 3001;
pool.query("Select Now()")
.then(result => {
    console.log("Neon database connected successfully");
    console.log("Database time:", result.rows[0].now);
})
.catch(error => {
    console.error("Neon connection failed:", error.message);
});
app.listen(PORT, () => {
    console.log(`The package service is running on port ${PORT}`);
});