async function convertCurrency(amount, targetCurrency) {
    const baseCurrency = "EGP";
    const currency = targetCurrency.toUpperCase();
    if (!Number.isFinite(Number(amount)) || Number(amount) < 0) {
        throw new Error ("Invalid amount");
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
        throw new Error("Invalid currency code");
    }
    if (currency === baseCurrency) {
        return {
            originalAmount: Number(amount),
            originalCurrency: baseCurrency,
            convertedAmount: Number(amount),
            targetCurrency: currency,
            exchangeRate: 1
        };
    }

    const url = `https://api.frankfurter.dev/v2/rate/${baseCurrency}/${currency}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error("Currency exchange rate could not be displayed");
    }
    const data = await response.json();
    return {
        originalAmount: Number(amount),
        originalCurrency: baseCurrency,
        convertedAmount: Number((Number(amount) * data.rate).toFixed(2)),
        targetCurrency: currency,
        exchangeRate: data.rate,
        rateDate: data.rateDate
    };
}

module.exports = {
    convertCurrency
};