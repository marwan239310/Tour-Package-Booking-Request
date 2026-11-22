const express = require("express");
const router = express.Router();
const packageController = require("../controllers/packageController");

router.get("/", packageController.getPackages);
router.post("/", packageController.createPackage);
router.patch("/:packageID/seats", packageController.updateSeats);
router.get("/:packageID/convert", packageController.convertPackagePrice);
router.get("/:packageID", packageController.getPackage);
router.put("/:packageID", packageController.updatePackage);

module.exports = router;