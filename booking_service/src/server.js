// Runs the booking service on your PC (npm start)
require("dotenv").config();
const app = require("./app");

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`The booking request service is running on port ${PORT}`);
});
