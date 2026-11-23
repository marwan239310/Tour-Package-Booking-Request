
const pool = require("../config/db");

async function getAllPackages(filters = {}) {
    let query = `
        SELECT
            package_id AS "packageID",
            title,
            destination,
            itinerary,
            start_date AS "startDate",
            end_date AS "endDate",
            price,
            total_seats AS "totalSeats",
            seats_left AS "seatsLeft",
            is_published AS "isPublished"
        FROM packages
        WHERE is_published = TRUE
    `;

    const values = [];
    let index = 1;

    if (filters.destination) {
        query += ` AND LOWER(destination) LIKE LOWER($${index})`;
        values.push(`%${filters.destination}%`);
        index++;
    }

    if (filters.date) {
        query += ` AND start_date = $${index}`;
        values.push(filters.date);
        index++;
    }

    if (filters.maxPrice !== undefined && filters.maxPrice !== "") {
        query += ` AND price <= $${index}`;
        values.push(Number(filters.maxPrice));
        index++;
    }

    const result = await pool.query(query, values);
    return result.rows;
}

async function getPackageByID(packageID) {
    const result = await pool.query(
        `SELECT
            package_id AS "packageID",
            title,
            destination,
            itinerary,
            start_date AS "startDate",
            end_date AS "endDate",
            price,
            total_seats AS "totalSeats",
            seats_left AS "seatsLeft",
            is_published AS "isPublished"
         FROM packages
         WHERE package_id = $1`,
        [packageID]
    );

    return result.rows[0] || null;
}

async function createPackage(data) {
    const result = await pool.query(
        `INSERT INTO packages
            (title, destination, itinerary, start_date, end_date,
             price, total_seats, seats_left, is_published)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, FALSE)
         RETURNING
            package_id AS "packageID",
            title,
            destination,
            itinerary,
            start_date AS "startDate",
            end_date AS "endDate",
            price,
            total_seats AS "totalSeats",
            seats_left AS "seatsLeft",
            is_published AS "isPublished"`,
        [
            data.title,
            data.destination,
            JSON.stringify(data.itinerary || []),
            data.startDate,
            data.endDate,
            Number(data.price),
            Number(data.totalSeats)
        ]
    );

    return result.rows[0];
}

async function updatePackage(packageID, data) {
    const allowedFields = {
        title: "title",
        destination: "destination",
        itinerary: "itinerary",
        startDate: "start_date",
        endDate: "end_date",
        price: "price",
        totalSeats: "total_seats",
        isPublished: "is_published"
    };

    const updates = [];
    const values = [];

    for (const [key, column] of Object.entries(allowedFields)) {
        if (data[key] !== undefined) {
            let value = data[key];

            if (key === "price") value = Number(value);
            if (key === "totalSeats") value = Number(value);
            if (key === "isPublished") value = Boolean(value);
            if (key === "itinerary") value = JSON.stringify(value);

            values.push(value);
            updates.push(`${column} = $${values.length}`);
        }
    }

    if (updates.length === 0) {
        return getPackageByID(packageID);
    }

    values.push(packageID);

    const result = await pool.query(
        `UPDATE packages
         SET ${updates.join(", ")}
         WHERE package_id = $${values.length}
         RETURNING
            package_id AS "packageID",
            title,
            destination,
            itinerary,
            start_date AS "startDate",
            end_date AS "endDate",
            price,
            total_seats AS "totalSeats",
            seats_left AS "seatsLeft",
            is_published AS "isPublished"`,
        values
    );

    return result.rows[0] || null;
}

async function updateSeats(packageID, seatsLeft) {
    const result = await pool.query(
        `UPDATE packages
         SET seats_left = $1
         WHERE package_id = $2
         AND $1 >= 0
         AND $1 <= total_seats
         RETURNING
            package_id AS "packageID",
            title,
            destination,
            itinerary,
            start_date AS "startDate",
            end_date AS "endDate",
            price,
            total_seats AS "totalSeats",
            seats_left AS "seatsLeft",
            is_published AS "isPublished"`,
        [seatsLeft, packageID]
    );

    if (result.rows.length === 0) {
        const existing = await getPackageByID(packageID);

        if (!existing) return null;

        throw new Error("Seats left must be between 0 and total seats");
    }

    return result.rows[0];
}
module.exports = {
    getAllPackages,
    getPackageByID,
    createPackage,
    updatePackage,
    updateSeats
};
