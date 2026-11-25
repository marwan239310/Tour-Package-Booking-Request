
const { randomUUID } = require("crypto");
const {
    ScanCommand,
    GetCommand,
    PutCommand,
    UpdateCommand
} = require("@aws-sdk/lib-dynamodb");

const dynamodb = require("../config/dynamodb");

const TABLE_NAME = "Packages";

function formatPackage(item) {
    if (!item) return null;

    return {
        packageID: item.packageId,
        title: item.title,
        destination: item.destination,
        itinerary: item.itinerary,
        startDate: item.startDate,
        endDate: item.endDate,
        price: item.price,
        totalSeats: item.totalSeats,
        seatsLeft: item.seatsLeft,
        isPublished: item.isPublished
    };
}

async function getAllPackages(filters = {}) {
    let items = [];
    let lastKey;

    do {
        const result = await dynamodb.send(
            new ScanCommand({
                TableName: TABLE_NAME,
                ExclusiveStartKey: lastKey
            })
        );

        items = items.concat(result.Items || []);
        lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return items
        .filter(pkg => pkg.isPublished === true)
        .filter(pkg =>
            !filters.destination ||
            pkg.destination.toLowerCase().includes(
                filters.destination.toLowerCase()
            )
        )
        .filter(pkg =>
            !filters.date || pkg.startDate === filters.date
        )
        .filter(pkg =>
            filters.maxPrice === undefined ||
            filters.maxPrice === "" ||
            Number(pkg.price) <= Number(filters.maxPrice)
        )
        .map(formatPackage);
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
    const newPackage = {
        packageId: randomUUID(),
        title: data.title,
        destination: data.destination,
        itinerary: data.itinerary || [],
        startDate: data.startDate,
        endDate: data.endDate,
        price: Number(data.price),
        totalSeats: Number(data.totalSeats),
        seatsLeft: Number(data.totalSeats),
        isPublished: false
    };

    await dynamodb.send(
        new PutCommand({
            TableName: TABLE_NAME,
            Item: newPackage,
            ConditionExpression: "attribute_not_exists(packageId)"
        })
    );

    return formatPackage(newPackage);
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
        "isPublished"
    ];

    const names = {};
    const values = {};
    const updates = [];

    for (const field of allowedFields) {
        if (data[field] !== undefined) {
            names[`#${field}`] = field;

            let value = data[field];

            if (field === "price" || field === "totalSeats") {
                value = Number(value);
            }

            values[`:${field}`] = value;
            updates.push(`#${field} = :${field}`);
        }
    }

    if (updates.length === 0) {
        return getPackageByID(packageID);
    }

    try {
        const result = await dynamodb.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: {
                    packageId: packageID
                },
                UpdateExpression: `SET ${updates.join(", ")}`,
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: values,
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

            if (!existing) return null;

            throw new Error(
                "Seats left must be between 0 and total seats"
            );
        }

        throw error;
    }
}

module.exports = {
    getAllPackages,
    getPackageByID,
    createPackage,
    updatePackage,
    updateSeats
};
