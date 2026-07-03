import fs from 'fs';
import path from 'path';

function walk(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const stat = fs.statSync(path.join(dir, file));
    if (stat.isDirectory() && file !== 'node_modules') {
      walk(path.join(dir, file), fileList);
    } else if (file.endsWith('.js') || file.endsWith('.jsx')) {
      fileList.push(path.join(dir, file));
    }
  }
  return fileList;
}

const files = walk('./services');
let fixed = 0;

files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  
  // Calculate directory depth.
  // Windows path.sep is '\'. Example: 'services\api\server.js' -> depth 2.
  const depth = f.split(path.sep).length - 1;
  const correctPrefix = '../'.repeat(depth) + 'packages';
  
  const newContent = content.replace(/(?:\.\.\/)+packages/g, correctPrefix);
  
  if (content !== newContent) {
    fs.writeFileSync(f, newContent);
    fixed++;
  }
});

console.log(`Fixed ${fixed} files.`);
