import { createApp } from './services/api/app.js';

const app = createApp();
console.log('Routes mounted on Express app:');
app._router.stack.forEach(layer => {
  if (layer.route) {
    console.log(layer.route.path);
  } else if (layer.name === 'router' && layer.regexp) {
    console.log('Router mounted at:', layer.regexp);
  }
});
