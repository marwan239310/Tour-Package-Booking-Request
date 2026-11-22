const  packageService = require("../services/packageService");
const currencyService = require("../services/currencyService");


function getPackages(req, res) {
    const packages = packageService.getAllPackages(req.query);
    res.status(200).json(packages);
}
function getPackage(req, res) {
    const pkg = packageService.getPackageByID(req.params.packageID);
    if (!pkg) {
        return res.status(404).json({ message: "The packages is not found"});
    }
    res.status(200).json(pkg);
}

function createPackage(req, res) {
    const { title, 
        destination,
        itinerary, 
        startDate,
        endDate,
        price,
        totalSeats
    } = req.body;
    if (
        !title || !destination || !itinerary || !startDate || !endDate || price === undefined || totalSeats === undefined 
    ) {
        return res.status(400).json({
message: "All required package fields must be provided",
        }
    );

    }

    if ( Number(price) < 0 || !Number.isFinite(Number(price)) || !Number.isInteger(Number(totalSeats)) || Number(totalSeats) <= 0 ) {
        return res.status(400).json({
            message: "The amount of price and number of total seats must be non-negative"
        });
    }
    const newPackage = packageService.createPackage(req.body);
    res.status(201).json(newPackage);
}

function updatePackage(req, res) {
    const updatedPackage = packageService.updatePackage(
        req.params.packageID,
        req.body
    );
    if (!updatedPackage) {
        return res.status(404).json({ message: "Package not found"});
    }
    res.status(200).json(updatedPackage);
}

function updateSeats(req, res) {
    const seatsLeft = Number(req.body.seatsLeft);
    try {
        const updatedPackage = packageService.updateSeats(
            req.params.packageID, seatsLeft
        );
        if (!updatedPackage) {
            return res.status(404).json({
                message: "Package not found" 
            });
        }
        res.status(200).json(updatedPackage);
    } catch (error) {
        res.status(400).json({
            message: error.message
        });
    }
}

async function convertPackagePrice(req, res) {
    try {
        const pkg = packageService.getPackageByID(req.params.packageID);
        if (!pkg) {
            return res.status(404).json({
                message: "The package is not found"
            });
        }
        const currency = req.query.currency;
        if (!currency) {
            return res.status(400).json({
                message: "Target currency must be provided"
            });
        }
        const result = await currencyService.convertCurrency(
            pkg.price, currency
        );
        res.status(200).json({
            packageID: pkg.packageID, 
            title: pkg.title,
            ...result
        });
    } catch (error) {
        res.status(400).json({
            message: error.message
        });
    }
}

module.exports = {
    getPackages,
    getPackage,
    createPackage,
    updatePackage,
    updateSeats,
    convertPackagePrice
};

