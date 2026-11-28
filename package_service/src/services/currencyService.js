// Converts package prices (stored in EGP) using the Frankfurter exchange-rate API.
// The API is free and needs no key. Its address can be changed with EXCHANGE_API_URL.

const BASE_CURRENCY = "EGP";
const EXCHANGE_API_URL = (process.env.EXCHANGE_API_URL || "https://api.frankfurter.dev/v2").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.EXCHANGE_API_TIMEOUT_MS) || 5000;
const CACHE_MS = 60 * 60 * 1000; // rates change once a day, so one hour is safe

const rateCache = new Map();

function codedError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

async function getRate(currency) {
    const cached = rateCache.get(currency);
    if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
        return cached;
    }

    let response;
    try {
        response = await fetch(`${EXCHANGE_API_URL}/rate/${BASE_CURRENCY}/${currency}`, {
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
    } catch (error) {
        console.error("[package-service] exchange-rate API unreachable:", error.message);
        throw codedError("RATE_UNAVAILABLE", "The exchange-rate service is not available right now");
    }

    if (response.status === 404 || response.status === 422 || response.status === 400) {
        throw codedError("UNSUPPORTED_CURRENCY", `Currency ${currency} is not supported`);
    }

    if (!response.ok) {
        console.error(`[package-service] exchange-rate API answered HTTP ${response.status}`);
        throw codedError("RATE_UNAVAILABLE", "The exchange-rate service is not available right now");
    }

    const data = await response.json().catch(() => ({}));
    const rate = Number(data.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
        throw codedError("RATE_UNAVAILABLE", "The exchange-rate service returned an invalid rate");
    }

    const entry = { rate, rateDate: data.date || data.rateDate || null, fetchedAt: Date.now() };
    rateCache.set(currency, entry);
    return entry;
}

async function convertCurrency(amount, targetCurrency) {
    const currency = String(targetCurrency || "").toUpperCase();
    const value = Number(amount);

    if (!Number.isFinite(value) || value < 0) {
        throw codedError("INVALID_AMOUNT", "Invalid amount");
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
        throw codedError("UNSUPPORTED_CURRENCY", "Invalid currency code");
    }

    if (currency === BASE_CURRENCY) {
        return {
            originalAmount: value,
            originalCurrency: BASE_CURRENCY,
            convertedAmount: value,
            targetCurrency: currency,
            exchangeRate: 1
        };
    }

    const { rate, rateDate } = await getRate(currency);
    return {
        originalAmount: value,
        originalCurrency: BASE_CURRENCY,
        convertedAmount: Number((value * rate).toFixed(2)),
        targetCurrency: currency,
        exchangeRate: rate,
        rateDate
    };
}

module.exports = {
    convertCurrency,
    // exported for tests
    _clearCache: () => rateCache.clear()
};
