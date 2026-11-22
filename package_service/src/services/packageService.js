const { randomUUID } = require("crypto");

let packages = [];

function getAllPackages(filters = {}) {
    return packages.filter((pkg) => {
        if (!pkg.isPublished) 
        return false;
    if (filters.destination && !pkg.destination.toLowerCase().includes(filters.destination.toLowerCase())
    ) return false;
if (filters.date && pkg.startDate !== filters.date) return false;
if (filters.maxPrice && pkg.price > Number(filters.maxPrice)) return false;
return true;
    });
}

function getPackageByID(packageID) {
    return packages.find((pkg) => pkg.packageID === packageID);
}

function createPackage(data){
    const newPackage = {
        packageID: randomUUID(),
        title: data.title,
        destination: data.destination,
        itinerary: data.itinerary || [],
        startDate: data.startDate,
        endDate: data.endDate,
        price: Number(data.price),
        totalSeats: Number(data.totalSeats),
        seatsLeft: Number(data.totalSeats),
        isPublished: false,
    };
    packages.push(newPackage);
    return newPackage;
}

function updatePackage(packageID, data) {
    const pkg = getPackageByID(packageID);
    if (!pkg) return null;

    Object.assign(pkg, data);

    if (data.price !== undefined) {
        pkg.price = Number(data.price);
    }
    if (data.isPublished !== undefined) {
        pkg.isPublished = Boolean(data.isPublished);
    }
    return pkg;
}

function updateSeats(packageID, seatsLeft){
    const pkg = getPackageByID(packageID);
    if (!pkg) return null;
    if (!Number.isInteger(seatsLeft) || seatsLeft < 0 || seatsLeft > pkg.totalSeats) {
        throw new Error("Seats left must be 0 and total seats cannot be 0")
    }
    pkg.seatsLeft = seatsLeft;
    return pkg; 
}

module.exports= {
    getAllPackages,
    getPackageByID,
    createPackage,
    updatePackage,
    updateSeats,
};