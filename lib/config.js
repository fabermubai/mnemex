import fs from 'fs';
import path from 'path';

const CONFIG_FILENAME = 'mnemex.config.json';

/**
 * Load the Mnemex config from <storePath>/mnemex.config.json.
 * Returns {} if the file doesn't exist or is unreadable.
 *
 * @param {string} storePath — peer store directory (e.g. "stores/mnemex-admin")
 * @returns {object}
 */
export function loadConfig(storePath) {
    const filePath = path.join(storePath, CONFIG_FILENAME);
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (_e) { /* corrupt or unreadable — return empty */ }
    return {};
}

/**
 * Save (merge) data into <storePath>/mnemex.config.json.
 * Creates the file if it doesn't exist. Merges with existing data.
 *
 * @param {string} storePath — peer store directory
 * @param {object} data — key/value pairs to merge
 */
export function saveConfig(storePath, data) {
    const filePath = path.join(storePath, CONFIG_FILENAME);
    let existing = {};
    try {
        if (fs.existsSync(filePath)) {
            existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (_e) { /* start fresh */ }
    const merged = { ...existing, ...data };
    fs.mkdirSync(storePath, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n');
}
