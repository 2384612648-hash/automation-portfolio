import { build } from 'esbuild';
await build({entryPoints: ['src/app.js'], bundle: true, minify: true, sourcemap: false, outfile: 'public/app.js', target: ['es2022'], legalComments: 'eof'});
console.log('Built public/app.js');
