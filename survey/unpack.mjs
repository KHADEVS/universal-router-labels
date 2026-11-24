import fs from 'node:fs';
import zlib from 'node:zlib';
const at = (f) => new URL(f, import.meta.url);
fs.writeFileSync(at('sample.json'), zlib.gunzipSync(fs.readFileSync(at('sample.json.gz'))));
