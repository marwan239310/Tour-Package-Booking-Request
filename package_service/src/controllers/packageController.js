const packageService = require("../services/packageService");
const currencyService = require("../services/currencyService");
const {
    validateNewPackage,
    validatePackageUpdate,
    validateSearchFilters
} = require("../validation/packageValidation");

// Unexpected errors are logged (CloudWatch on Lambda) but not shown to the client
function serverError(res, action, error) {
    console.error(`[package-service] ${action} failed:`, error);
    return res.status(500).json({ message: `Could not ${action}. Please try again later.` });
}

function validTravelers(value) {
    const travelers = Number(value);
    return Number.isInteger(travelers) && travelers > 0 && travelers <= 1000 ? travelers : null;
}

// GET /packages : search and filter (destination, startDate, endDate, maxPrice)
async function getPackages(req, res) {
    const validationError = validateSearchFilters(req.query);
    if (validationError) {
        return res.status(400).json({ message: validationError });
    }

    try {
        const packages = await packageService.getAllPackages(req.query);
        return res.status(200).json(packages);
    } catch (error) {
        return serverError(res, "load packages", error);
    }
}

// GET /packages/:packageID : full details including itinerary
async function getPackage(req, res) {
    try {
        const pkg = await packageService.getPackageByID(req.params.packageID);

        if (!pkg) {
            return res.status(404).json({ message: "The package is not found" });
        }

        return res.status(200).json(pkg);
    } catch (error) {
        return serverError(res, "load the package", error);
    }
}

// POST /packages (staff)
async function createPackage(req, res) {
    const validationError = validateNewPackage(req.body || {});
    if (validationError) {
        return res.status(400).json({ message: validationError });
    }

    try {
        const newPackage = await packageService.createPackage(req.body);
        console.log(`[package-service] package ${newPackage.packageID} created by ${req.user ? req.user.username || req.user.sub : "unknown"}`);
        return res.status(201).json(newPackage);
    } catch (error) {
        return serverError(res, "create the package", error);
    }
}

// PUT /packages/:packageID (staff): edit, publish or hide
async function updatePackage(req, res) {
    const validationError = validatePackageUpdate(req.body || {});
    if (validationError) {
        return res.status(400).json({ message: validationError });
    }

    try {
        const updatedPackage = await packageService.updatePackage(
            req.params.packageID,
            req.body
        );

        if (!updatedPackage) {
            return res.status(404).json({ message: "Package not found" });
        }

        console.log(`[package-service] package ${updatedPackage.packageID} updated by ${req.user ? req.user.username || req.user.sub : "unknown"}`);
        return res.status(200).json(updatedPackage);
    } catch (error) {
        if (error.code === "INVALID_UPDATE") {
            return res.status(400).json({ message: error.message });
        }

        if (error.code === "SEAT_CONFLICT") {
            return res.status(409).json({ message: error.message });
        }

        return serverError(res, "update the package", error);
    }
}

// PATCH /packages/:packageID/reserve : called when a booking is confirmed
async function reserveSeats(req, res) {
    const travelers = validTravelers((req.body || {}).travelers);
    if (!travelers) {
        return res.status(400).json({ message: "travelers must be a whole number between 1 and 1000" });
    }

    try {
        const updatedPackage = await packageService.reserveSeats(req.params.packageID, travelers);

        if (!updatedPackage) {
            return res.status(404).json({ message: "Package not found" });
        }

        return res.status(200).json({
            message: "Seats reserved successfully",
            package: updatedPackage
        });
    } catch (error) {
        if (error.code === "INSUFFICIENT_SEATS") {
            return res.status(409).json({ message: error.message });
        }

        return serverError(res, "reserve seats", error);
    }
}

// PATCH /packages/:packageID/release : called when a confirmed booking is cancelled
async function releaseSeats(req, res) {
    const travelers = validTravelers((req.body || {}).travelers);
    if (!travelers) {
        return res.status(400).json({ message: "travelers must be a whole number between 1 and 1000" });
    }

    try {
        const updatedPackage = await packageService.releaseSeats(req.params.packageID, travelers);

        if (!updatedPackage) {
            return res.status(404).json({ message: "Package not found" });
        }

        return res.status(200).json({
            message: "Seats released successfully",
            package: updatedPackage
        });
    } catch (error) {
        if (error.code === "SEAT_CAPACITY_EXCEEDED") {
            return res.status(409).json({ message: error.message });
        }

        return serverError(res, "release seats", error);
    }
}

// GET /packages/:packageID/convert?currency=USD : price in another currency (external API)
async function convertPackagePrice(req, res) {
    const currency = String(req.query.currency || "").trim().toUpperCase();

    if (!currency) {
        return res.status(400).json({ message: "Target currency must be provided, e.g. ?currency=USD" });
    }

    if (!/^[A-Z]{3}$/.test(currency)) {
        return res.status(400).json({ message: "Currency must be a 3-letter code such as USD or EUR" });
    }

    try {
        const pkg = await packageService.getPackageByID(req.params.packageID);

        if (!pkg) {
            return res.status(404).json({ message: "The package is not found" });
        }

        const result = await currencyService.convertCurrency(Number(pkg.price), currency);

        return res.status(200).json({
            packageID: pkg.packageID,
            title: pkg.title,
            ...result
        });
    } catch (error) {
        if (error.code === "UNSUPPORTED_CURRENCY") {
            return res.status(400).json({ message: error.message });
        }

        if (error.code === "RATE_UNAVAILABLE") {
            return res.status(502).json({ message: error.message });
        }

        return serverError(res, "convert the price", error);
    }
}

module.exports = {
    getPackages,
    getPackage,
    createPackage,
    updatePackage,
    reserveSeats,
    releaseSeats,
    convertPackagePrice
};
