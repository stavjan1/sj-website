// The app used to be one file. It is five plus a core now, and a guard that
// reads only sale/app.js would quietly stop guarding the moment a function
// moved — passing not because the rule holds but because it can no longer see
// the code. Every source-level test reads the app through here instead, so a
// future split (or merge) changes one list rather than twenty-one files.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// In load order, which is also the order the browser sees them.
export const APP_FILES = [
    'site/sale/app.js',
    'site/sale/chat.js',
    'site/sale/checkups.js',
    'site/sale/market.js',
    'site/sale/reports.js',
    'site/sale/admin.js', 'site/sale/helper.js',
];

export function readApp() {
    // CRLF normalised, because this repo checks out with core.autocrlf=true on
    // Windows and half the guards slice a function body on '\n}\n'. Without
    // this they match nothing, slice to the end of the file, and then assert
    // things about code they were never meant to be reading.
    return APP_FILES
        .map((f) => readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'))
        .join('\n');
}
