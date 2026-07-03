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

const files = walk('./services').concat(walk('./packages'));
const deps = new Set();

files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const matches = content.matchAll(/import .*? from '([^'.\/]+.*?)'/g);
  for (const match of matches) {
    if (!match[1].startsWith('node:')) {
      // get base package name (handle scoped packages like @tanstack/react-query)
      let pkg = match[1];
      if (pkg.startsWith('@')) {
        pkg = pkg.split('/').slice(0, 2).join('/');
      } else {
        pkg = pkg.split('/')[0];
      }
      deps.add(pkg);
    }
  }
});
console.log(Array.from(deps));
