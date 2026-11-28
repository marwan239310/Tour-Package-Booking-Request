
const { randomUUID } = require("crypto");

const {
    ScanCommand,
    GetCommand,
    PutCommand,
    UpdateCommand
} = require("@aws-sdk/lib-dynamodb");

const dynamodb = require("../config/dynamodb");

const TABLE_NAME = process.env.DYNAMODB_TABLE || "Packages";

// Query strings and form data send "true"/"false" as text, so compare as booleans
function toBoolean(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const text = value.trim().toLowerCase();
        if (text === "true" || text === "1") return true;
        if (text === "false" || text === "0" || text === "") return false;
    }
    if (typeof value === "number") return value === 1;
    return undefined;
}


function formatPackage(item) {
    if (!item) return null;

    return {
        packageID: item.packageId,
        title: item.title,
        destination: item.destination,
        itinerary: item.itinerary || [],
        startDate: item.startDate,
        endDate: item.endDate,
        price: Number(item.price),
        totalSeats: Number(item.totalSeats),
        seatsLeft: Number(item.seatsLeft),
        isPublished: toBoolean(item.isPublished) === true
    };
}


async function getAllPackages(filters = {}) {
    const result = await dynamodb.send(
        new ScanCommand({
            TableName: TABLE_NAME
        })
    );

    let packages = (result.Items || []).map(formatPackage);

    // Default: only published packages. Staff can ask for drafts with
    // ?isPublished=false or for everything with ?includeUnpublished=true
    if (toBoolean(filters.includeUnpublished) !== true) {
        const wanted = filters.isPublished === undefined
            ? true
            : toBoolean(filters.isPublished) === true;

        packages = packages.filter(p => p.isPublished === wanted);
    }

    // Partial, case-insensitive match: "alex" finds "Alexandria"
    const destination = String(filters.destination || "").trim().toLowerCase();
    if (destination) {
        packages = packages.filter(
            p => p.destination && p.destination.toLowerCase().includes(destination)
        );
    }

    // Trips that start on or after startDate
    if (filters.startDate) {
        packages = packages.filter(p => p.startDate >= filters.startDate);
    }

    // Trips that end on or before endDate
    if (filters.endDate) {
        packages = packages.filter(p => p.endDate <= filters.endDate);
    }

    if (filters.maxPrice !== undefined && filters.maxPrice !== "") {
        packages = packages.filter(p => p.price <= Number(filters.maxPrice));
    }

    // Soonest trips first
    packages.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

    return packages;
}


async function getPackageByID(packageID) {
    const result = await dynamodb.send(
        new GetCommand({
            TableName: TABLE_NAME,
            Key: {
                packageId: packageID
            }
        })
    );

    return formatPackage(result.Item);
}


async function createPackage(data) {
    const packageData = {
        packageId: randomUUID(),
        title: String(data.title).trim(),
        destination: String(data.destination).trim(),
        itinerary: (data.itinerary || []).map(item => String(item).trim()),
        startDate: data.startDate,
        endDate: data.endDate,
        price: Number(data.price),
        totalSeats: Number(data.totalSeats),
        seatsLeft: Number(data.totalSeats),
        isPublished: toBoolean(data.isPublished) === true
    };

    await dynamodb.send(
        new PutCommand({
            TableName: TABLE_NAME,
            Item: packageData,
            ConditionExpression: "attribute_not_exists(packageId)"
        })
    );

    return formatPackage(packageData);
}

async function updatePackage(packageID, data) {
    // seatsLeft is not editable here: it only changes through reserve/release
    const allowedFields = [
        "title",
        "destination",
        "itinerary",
        "startDate",
        "endDate",
        "price",
        "totalSeats",
        "isPublished"
    ];

    const updateFields = Object.keys(data).filter(
        field => allowedFields.includes(field)
    );

    if (updateFields.length === 0) {
        const error = new Error("No valid fields provided for update");
        error.code = "INVALID_UPDATE";
        throw error;
    }

    const existing = await getPackageByID(packageID);
    if (!existing) {
        return null;
    }

    // The new dates must still be in order, even if only one of them changes
    const newStart = data.startDate !== undefined ? data.startDate : existing.startDate;
    const newEnd = data.endDate !== undefined ? data.endDate : existing.endDate;
    if (newEnd < newStart) {
        const error = new Error("End date cannot be before the start date");
        error.code = "INVALID_UPDATE";
        throw error;
    }

    const expressionNames = {};
    const expressionValues = {};
    const updateExpressions = [];
    let conditionExpression = "attribute_exists(packageId)";

    updateFields.forEach((field, index) => {
        const nameKey = `#field${index}`;
        const valueKey = `:value${index}`;

        expressionNames[nameKey] = field;

        let value = data[field];

        if (field === "price" || field === "totalSeats") {
            value = Number(value);
        }

        if (field === "isPublished") {
            value = toBoolean(value) === true;
        }

        if (field === "title" || field === "destination") {
            value = String(value).trim();
        }

        if (field === "itinerary") {
            value = value.map(item => String(item).trim());
        }

        expressionValues[valueKey] = value;
        updateExpressions.push(`${nameKey} = ${valueKey}`);
    });

    // Changing the capacity moves seatsLeft by the same amount, so seats
    // that are already booked stay booked. Refuse if it would go below zero.
    if (updateFields.includes("totalSeats")) {
        const newTotal = Number(data.totalSeats);
        const delta = newTotal - existing.totalSeats;
        const booked = existing.totalSeats - existing.seatsLeft;

        if (newTotal < booked) {
            const error = new Error(
                `Total seats cannot be lower than the ${booked} seats already booked`
            );
            error.code = "INVALID_UPDATE";
            throw error;
        }

        expressionNames["#seatsLeft"] = "seatsLeft";
        expressionNames["#totalSeats"] = "totalSeats";
        expressionValues[":seatDelta"] = delta;
        expressionValues[":oldTotal"] = existing.totalSeats;
        updateExpressions.push("#seatsLeft = #seatsLeft + :seatDelta");
        // Protects against a booking happening between the read and the write
        conditionExpression += " AND #totalSeats = :oldTotal";
        if (delta < 0) {
            expressionValues[":minSeatsLeft"] = -delta;
            conditionExpression += " AND #seatsLeft >= :minSeatsLeft";
        }
    }

    try {
        const result = await dynamodb.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: {
                    packageId: packageID
                },
                UpdateExpression: `SET ${updateExpressions.join(", ")}`,
                ExpressionAttributeNames: expressionNames,
                ExpressionAttributeValues: expressionValues,
                ConditionExpression: conditionExpression,
                ReturnValues: "ALL_NEW"
            })
        );

        return formatPackage(result.Attributes);
    } catch (error) {
        if (error.name === "ConditionalCheckFailedException") {
            const stillExists = await getPackageByID(packageID);
            if (!stillExists) {
                return null;
            }

            const conflict = new Error(
                "Seats changed while saving (a booking was made). Please try again."
            );
            conflict.code = "SEAT_CONFLICT";
            throw conflict;
        }

        throw error;
    }
}


async function reserveSeats(packageID, travelers) {
    try {
        const result = await dynamodb.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: {
                    packageId: packageID
                },
                UpdateExpression:
                    "SET seatsLeft = seatsLeft - :travelers",
                ExpressionAttributeValues: {
                    ":travelers": travelers
                },
                ConditionExpression:
                    "attribute_exists(packageId) AND attribute_exists(seatsLeft) AND seatsLeft >= :travelers",
                ReturnValues: "ALL_NEW"
            })
        );

        return formatPackage(result.Attributes);
    } catch (error) {
        if (error.name === "ConditionalCheckFailedException") {
            const existing = await getPackageByID(packageID);

            if (!existing) {
                return null;
            }

            const conflict = new Error("Not enough seats available");
            conflict.code = "INSUFFICIENT_SEATS";
            throw conflict;
        }

        throw error;
    }
}


async function releaseSeats(packageID, travelers) {
    // Get the package to calculate the maximum allowed seats
    const existing = await getPackageByID(packageID);

    if (!existing) {
        return null;
    }

    const maxSeats = Number(existing.totalSeats) - travelers;

    try {
        const result = await dynamodb.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: {
                    packageId: packageID
                },
                UpdateExpression:
                    "SET seatsLeft = seatsLeft + :travelers",
                ExpressionAttributeValues: {
                    ":travelers": travelers,
                    ":maxSeats": maxSeats
                },
                ConditionExpression:
                    "attribute_exists(packageId) AND attribute_exists(seatsLeft) AND seatsLeft <= :maxSeats",
                ReturnValues: "ALL_NEW"
            })
        );

        return formatPackage(result.Attributes);
    } catch (error) {
        if (error.name === "ConditionalCheckFailedException") {
            const conflict = new Error(
                "Releasing these seats would exceed total capacity"
            );
            conflict.code = "SEAT_CAPACITY_EXCEEDED";
            throw conflict;
        }

        throw error;
    }
}


module.exports = {
    getAllPackages,
    getPackageByID,
    createPackage,
    updatePackage,
    reserveSeats,
    releaseSeats
};
