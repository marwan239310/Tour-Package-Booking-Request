
const { randomUUID } = require("crypto");

const {
    ScanCommand,
    GetCommand,
    PutCommand,
    UpdateCommand
} = require("@aws-sdk/lib-dynamodb");

const dynamodb = require("../config/dynamodb");

const TABLE_NAME = process.env.DYNAMODB_TABLE || "Packages";


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
        isPublished: item.isPublished
    };
}


async function getAllPackages(filters = {}) {
    const result = await dynamodb.send(
        new ScanCommand({
            TableName: TABLE_NAME
        })
    );

    let packages = (result.Items || []).map(formatPackage);

    if (filters.isPublished !== undefined) {
        packages = packages.filter(
            p => p.isPublished === filters.isPublished
        );
    } else {
        packages = packages.filter(p => p.isPublished === true);
    }

    if (filters.destination) {
        packages = packages.filter(
            p => p.destination &&
                p.destination.toLowerCase() === filters.destination.toLowerCase()
        );
    }

    if (filters.startDate) {
        packages = packages.filter(
            p => p.startDate >= filters.startDate
        );
    }

    if (filters.endDate) {
        packages = packages.filter(
            p => p.endDate <= filters.endDate
        );
    }

    if (filters.maxPrice !== undefined) {
        packages = packages.filter(
            p => p.price <= Number(filters.maxPrice)
        );
    }

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
        title: data.title,
        destination: data.destination,
        itinerary: data.itinerary || [],
        startDate: data.startDate,
        endDate: data.endDate,
        price: Number(data.price),
        totalSeats: Number(data.totalSeats),
        seatsLeft: Number(data.totalSeats),
        isPublished: data.isPublished === true
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
    const allowedFields = [
        "title",
        "destination",
        "itinerary",
        "startDate",
        "endDate",
        "price",
        "totalSeats",
        "seatsLeft",
        "isPublished"
    ];

    const updateFields = Object.keys(data).filter(
        field => allowedFields.includes(field)
    );

    if (updateFields.length === 0) {
        throw new Error("No valid fields provided for update");
    }

    const expressionNames = {};
    const expressionValues = {};
    const updateExpressions = [];

    updateFields.forEach((field, index) => {
        const nameKey = `#field${index}`;
        const valueKey = `:value${index}`;

        expressionNames[nameKey] = field;

        let value = data[field];

        if (field === "price" || field === "totalSeats" || field === "seatsLeft") {
            value = Number(value);
        }

        expressionValues[valueKey] = value;
        updateExpressions.push(`${nameKey} = ${valueKey}`);
    });

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
                ConditionExpression: "attribute_exists(packageId)",
                ReturnValues: "ALL_NEW"
            })
        );

        return formatPackage(result.Attributes);
    } catch (error) {
        if (error.name === "ConditionalCheckFailedException") {
            return null;
        }

        throw error;
    }
}

async function updateSeats(packageID, seatsLeft) {
    try {
        const result = await dynamodb.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: {
                    packageId: packageID
                },
                UpdateExpression: "SET seatsLeft = :seatsLeft",
                ExpressionAttributeValues: {
                    ":seatsLeft": seatsLeft,
                    ":zero": 0
                },
                ConditionExpression:
                    "attribute_exists(packageId) AND :seatsLeft >= :zero AND :seatsLeft <= totalSeats",
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

            throw new Error(
                "Seats left must be between 0 and total seats"
            );
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
    updateSeats,
    reserveSeats,
    releaseSeats
};
