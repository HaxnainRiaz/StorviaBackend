const crypto = require('crypto');

/**
 * Generates SHA-256 hash of a string
 * @param {string} val 
 * @returns {string|null}
 */
const sha256 = (val) => {
    if (!val) return null;
    return crypto.createHash('sha256').update(val).digest('hex');
};

/**
 * Normalizes email address for Meta CAPI
 * @param {string} email 
 * @returns {string|null}
 */
const normalizeEmail = (email) => {
    if (!email) return null;
    return String(email).trim().toLowerCase();
};

/**
 * Normalizes phone number (only digits)
 * @param {string} phone 
 * @returns {string|null}
 */
const normalizePhone = (phone) => {
    if (!phone) return null;
    // Strip all non-digits
    return String(phone).replace(/[^\d]/g, '');
};

/**
 * Normalizes string properties like names, cities, etc.
 * @param {string} str 
 * @returns {string|null}
 */
const normalizeString = (str) => {
    if (!str) return null;
    return String(str)
        .trim()
        .toLowerCase()
        .replace(/[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~]/g, ''); // Remove punctuation
};

/**
 * Normalizes and hashes a field if present
 * @param {string} value 
 * @param {string} type - 'email', 'phone', 'string', 'raw'
 * @returns {string|null}
 */
const hashField = (value, type = 'raw') => {
    if (!value) return null;
    
    let normalized = '';
    if (type === 'email') {
        normalized = normalizeEmail(value);
    } else if (type === 'phone') {
        normalized = normalizePhone(value);
    } else if (type === 'string') {
        normalized = normalizeString(value);
    } else {
        normalized = String(value).trim().toLowerCase();
    }
    
    return sha256(normalized);
};

module.exports = {
    sha256,
    normalizeEmail,
    normalizePhone,
    normalizeString,
    hashField
};
