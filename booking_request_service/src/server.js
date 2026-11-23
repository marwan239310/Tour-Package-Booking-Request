// The main file: it creates the Express app and starts the server
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const requestRoutes = require("./routes/requestRoutes");   // NEW: loads your routes file

const app = express();

app.use(cors());          // lets the frontend call this service
app.use(express.json());  // reads JSON from request bodies

// Health check: shows the service is running
app.get("/", (req, res) => {
  res.json({ message: "The booking request service is running" });
});

app.use("/requests", requestRoutes);   // NEW: every /requests URL goes to your routes

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`The booking request service is running on port ${PORT}`);
});
