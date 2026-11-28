// Input validation for the Package Service.
// Every function returns an error message (string) or null when the input is valid.

const LIMITS = {
    title: 100,
    destination: 60,
    itineraryItems: 30,
    itineraryItemLength: 200,
    maxPrice: 1000000,
    maxSeats: 1000
};

// Text with < or > could carry HTML/script, so it is rejected
const UNSAFE_TEXT = /[<>]/;

function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const date = new Date(`${value}T00:00:00Z`);
    // Rejects dates such as 2027-02-30 that JavaScript would roll over
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function checkText(name, value, maxLength) {
    if (typeof value !== "string" || !value.trim()) {
        return `${name} is required`;
    }
    if (value.trim().length > maxLength) {
        return `${name} must be at most ${maxLength} characters`;
    }
    if (UNSAFE_TEXT.test(value)) {
        return `${name} must not contain < or >`;
    }
    return null;
}

function checkItinerary(itinerary) {
    if (!Array.isArray(itinerary) || itinerary.length === 0) {
        return "Itinerary must be a list with at least one activity";
    }
    if (itinerary.length > LIMITS.itineraryItems) {
        return `Itinerary can have at most ${LIMITS.itineraryItems} activities`;
    }
    for (const item of itinerary) {
        const error = checkText("Each itinerary activity", item, LIMITS.itineraryItemLength);
        if (error) return error;
    }
    return null;
}

function checkPrice(price) {
    const value = Number(price);
    if (price === null || price === "" || !Number.isFinite(value) || value < 0 || value > LIMITS.maxPrice) {
        return `Price must be a number between 0 and ${LIMITS.maxPrice}`;
    }
    return null;
}

function checkTotalSeats(totalSeats) {
    const value = Number(totalSeats);
    if (!Number.isInteger(value) || value <= 0 || value > LIMITS.maxSeats) {
        return `Total seats must be a whole number between 1 and ${LIMITS.maxSeats}`;
    }
    return null;
}

function checkPublished(isPublished) {
    if (!["true", "false"].includes(String(isPublished).toLowerCase())) {
        return "isPublished must be true or false";
    }
    return null;
}

function checkDateOrder(startDate, endDate) {
    if (endDate < startDate) {
        return "End date cannot be before the start date";
    }
    return null;
}

// POST /packages: every field is required (isPublished is optional)
function validateNewPackage(body = {}) {
    const required = ["title", "destination", "itinerary", "startDate", "endDate", "price", "totalSeats"];
    const missing = required.filter(field => body[field] === undefined || body[field] === null || body[field] === "");
    if (missing.length > 0) {
        return `Missing required fields: ${missing.join(", ")}`;
    }

    return checkText("Title", body.title, LIMITS.title)
        || checkText("Destination", body.destination, LIMITS.destination)
        || checkItinerary(body.itinerary)
        || (isValidDate(body.startDate) ? null : "Start date must be a real date in YYYY-MM-DD format")
        || (isValidDate(body.endDate) ? null : "End date must be a real date in YYYY-MM-DD format")
        || checkDateOrder(body.startDate, body.endDate)
        || checkPrice(body.price)
        || checkTotalSeats(body.totalSeats)
        || (body.isPublished === undefined ? null : checkPublished(body.isPublished));
}

// PUT /packages/:id: only the fields sent are checked
function validatePackageUpdate(body = {}) {
    if (body.seatsLeft !== undefined) {
        return "seatsLeft cannot be edited directly; it changes through bookings";
    }

    const checks = {
        title: v => checkText("Title", v, LIMITS.title),
        destination: v => checkText("Destination", v, LIMITS.destination),
        itinerary: checkItinerary,
        startDate: v => (isValidDate(v) ? null : "Start date must be a real date in YYYY-MM-DD format"),
        endDate: v => (isValidDate(v) ? null : "End date must be a real date in YYYY-MM-DD format"),
        price: checkPrice,
        totalSeats: checkTotalSeats,
        isPublished: checkPublished
    };

    const fields = Object.keys(body).filter(field => checks[field]);
    if (fields.length === 0) {
        return `No valid fields to update. Allowed: ${Object.keys(checks).join(", ")}`;
    }

    for (const field of fields) {
        const error = checks[field](body[field]);
        if (error) return error;
    }

    if (body.startDate !== undefined && body.endDate !== undefined) {
        return checkDateOrder(body.startDate, body.endDate);
    }
    return null;
}

// GET /packages search filters
function validateSearchFilters(query = {}) {
    if (query.destination !== undefined && String(query.destination).length > LIMITS.destination) {
        return `Destination search must be at most ${LIMITS.destination} characters`;
    }
    if (query.startDate !== undefined && query.startDate !== "" && !isValidDate(query.startDate)) {
        return "startDate must be a real date in YYYY-MM-DD format";
    }
    if (query.endDate !== undefined && query.endDate !== "" && !isValidDate(query.endDate)) {
        return "endDate must be a real date in YYYY-MM-DD format";
    }
    if (query.startDate && query.endDate && query.endDate < query.startDate) {
        return "endDate cannot be before startDate";
    }
    if (query.maxPrice !== undefined && query.maxPrice !== "") {
        const maxPrice = Number(query.maxPrice);
        if (!Number.isFinite(maxPrice) || maxPrice < 0) {
            return "maxPrice must be a non-negative number";
        }
    }
    return null;
}

module.exports = {
    LIMITS,
    isValidDate,
    validateNewPackage,
    validatePackageUpdate,
    validateSearchFilters
};
