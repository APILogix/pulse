const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '../src/modules/auth/presentation/routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.routes.ts'));

const extractedRoutes = [];

files.forEach(file => {
  const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
  
  // A somewhat naive but effective regex for route definitions
  // e.g. fastify.post('/login', { preHandler: [loginRateLimit] }, async (request, reply) => { ... })
  const routeRegex = /fastify\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];
    
    // Attempt to extract handlers or preHandlers
    const blockStart = match.index;
    const preHandlerMatch = content.slice(blockStart, blockStart + 500).match(/preHandler:\s*\[([^\]]+)\]/);
    const middlewares = preHandlerMatch ? preHandlerMatch[1].split(',').map(s => s.trim()) : [];
    
    extractedRoutes.push({
      file,
      method,
      path: routePath,
      middlewares
    });
  }
});

fs.writeFileSync(path.join(__dirname, 'routes_summary.json'), JSON.stringify(extractedRoutes, null, 2));
console.log('Routes extracted to routes_summary.json');
