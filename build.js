import * as esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import fse from 'fs-extra';

const buildDir = 'docs';
const dataDir = 'data';

if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir);
}

await esbuild.build({
  entryPoints: ['index.js'],
  bundle: true,
  outfile: path.join(buildDir, 'bundle.js'),
  sourcemap: true,
  minify: true,
  format: 'esm',
  target: ['es2020']
}).then(() => {
// 3. Copy the HTML file
  fs.copyFile('index.html', path.join(buildDir, 'index.html'), (err) => {
    if (err) throw err;
    console.log('index.html copied to ' + buildDir);
  });

  fse.copy(dataDir, path.join(buildDir, dataDir), (err) => {
    if (err) throw err;
    console.log('data directory copied to ' + buildDir);
  });
  
  console.log('Build complete!');
}).catch(() => process.exit(1));
