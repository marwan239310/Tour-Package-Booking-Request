const express = require("express");
const router = express.Router();
const packageController = require("../controllers/packageController");
const { requireStaff, requireStaffForDrafts } = require("../middleware/requireStaff");

// Public: browse published packages (drafts need staff login)
router.get("/", requireStaffForDrafts, packageController.getPackages);

// Staff only: create and edit packages (including publishing)
router.post("/", requireStaff, packageController.createPackage);
router.put("/:packageID", requireStaff, packageController.updatePackage);

// Seat changes only happen through bookings (used by the booking service).
// The old PATCH /:packageID/seats endpoint was removed: it let anyone set any seat number.
router.patch("/:packageID/reserve", packageController.reserveSeats);
router.patch("/:packageID/release", packageController.releaseSeats);

router.get("/:packageID/convert", packageController.convertPackagePrice);
router.get("/:packageID", packageController.getPackage);

module.exports = router;
