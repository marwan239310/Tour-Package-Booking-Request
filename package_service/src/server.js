const express = require("express");
const cors = require("cors");
require("dotenv").config();
const packageRoutes = require("./routes/packageRoutes");

const app = express();
app.use(cors());
app.use(express.json());
app.get("/", (req, res) => {
    res.json({ message: "The package server is running" });

});
app.use ("/packages", packageRoutes);
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`The package service is running on port ${PORT}`);
});