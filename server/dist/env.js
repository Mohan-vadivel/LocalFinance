"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnv = loadEnv;
const fs_1 = require("fs");
const path_1 = require("path");
/** Loads apps/api/.env into process.env (values already set in the environment win). */
function loadEnv() {
    const file = (0, path_1.resolve)(__dirname, '../.env');
    if (!(0, fs_1.existsSync)(file))
        return;
    for (const line of (0, fs_1.readFileSync)(file, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined)
            process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
}
//# sourceMappingURL=env.js.map