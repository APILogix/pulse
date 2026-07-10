const fs = require('fs');

const domains = ['rules', 'events', 'silences', 'policies', 'templates', 'routing', 'metrics'];

for (const domain of domains) {
    const filePath = `src/modules/alerting/${domain}/${domain}.types.ts`;
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Remove the bad imports line first
    content = content.replace(/import \{ UuidSchema.*?;\n/, "");
    
    // Re-insert correct imports
    let imports = `import { UuidSchema, PaginationSchema, AlertSeveritySchema, type RequestMeta, type AlertSeverity } from '../types.js';\n`;
    
    if (domain === 'rules') {
        imports = `import { UuidSchema, PaginationSchema, type RequestMeta } from '../types.js';\n`;
    }
    
    content = content.replace("import { z } from 'zod';", "import { z } from 'zod';\n" + imports);
    
    fs.writeFileSync(filePath, content);
}

// In types.ts, we need to export the original shared types so they are still there
// UuidSchema, PaginationSchema, RequestMeta etc are in types.ts but we also need to re-export the domain types.

console.log('Fixed imports in domain types');
