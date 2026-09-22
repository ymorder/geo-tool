'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.resolve(process.cwd(), 'data');
if (fs.existsSync(dir)) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('removed', dir);
}
