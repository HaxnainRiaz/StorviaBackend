const crypto = require('crypto');

/**
 * Gets the encryption key from environment variables.
 */
const getEncryptionKey = (secret) => {
    const s = secret || process.env.META_ENCRYPTION_SECRET || 'fallback-secret-key-32-chars-long-!!!';
    return crypto.createHash('sha256').update(s).digest();
};

/**
 * Encrypts a plain text string using AES-256-CBC.
 */
const encryptToken = (plainText, secret) => {
    if (!plainText) return null;
    try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', getEncryptionKey(secret), iv);
        let encrypted = cipher.update(plainText, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return `${iv.toString('hex')}:${encrypted}`;
    } catch (error) {
        console.error('Encryption error:', error);
        return null;
    }
};

/**
 * Decrypts an AES-256-CBC encrypted string.
 */
const decryptToken = (encryptedValue, secret) => {
    if (!encryptedValue || !encryptedValue.includes(':')) return null;
    try {
        const [ivHex, encrypted] = encryptedValue.split(':');
        const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(secret), Buffer.from(ivHex, 'hex'));
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error);
        return null;
    }
};

// Convenience wrappers for PostEx (uses dedicated secret)
const encryptPostExToken = (plain) => encryptToken(plain, process.env.POSTEX_ENCRYPTION_SECRET);
const decryptPostExToken = (enc)   => decryptToken(enc,   process.env.POSTEX_ENCRYPTION_SECRET);

module.exports = {
    encryptToken,
    decryptToken,
    encryptPostExToken,
    decryptPostExToken
};

