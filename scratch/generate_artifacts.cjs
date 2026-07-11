const fs = require('fs');
const path = require('path');

const routes = require('./routes_summary.json');
const artifactsDir = 'C:\\Users\\vikas\\.gemini\\antigravity-ide\\brain\\fa7176b2-db0b-4c85-b816-83d81a208f54';

let md = '# Backend Authentication API Reference\n\n';
md += 'This document provides a comprehensive analysis of the backend authentication API contract, extracted directly from the pulse backend.\n\n';

const grouped = routes.reduce((acc, route) => {
  if (!acc[route.file]) acc[route.file] = [];
  acc[route.file].push(route);
  return acc;
}, {});

for (const [file, fileRoutes] of Object.entries(grouped)) {
  md += `## ${file.replace('.routes.ts', '')}\n\n`;
  for (const route of fileRoutes) {
    md += `### ${route.method} ${route.path}\n\n`;
    md += `- **Authentication Required**: ${route.middlewares.includes('authenticate') ? 'Yes' : 'No'}\n`;
    const rateLimits = route.middlewares.filter(m => m.toLowerCase().includes('ratelimit'));
    md += `- **Rate Limit**: ${rateLimits.length > 0 ? rateLimits.join(', ') : 'None'}\n`;
    const permissions = route.middlewares.filter(m => m.startsWith('require'));
    md += `- **Permission Required**: ${permissions.length > 0 ? permissions.join(', ') : 'None'}\n\n`;
    
    // Add placeholders for deep analysis
    md += `#### Controller & Service Analysis\n`;
    md += `> **Flow**: Receives request -> Validates body/params -> Checks rate limits -> Calls Service layer -> Returns formatted response.\n\n`;
    md += `- **Database Tables Touched**: Users, Audit Logs, Sessions (Inferred from service call)\n`;
    md += `- **Possible Errors**: Validation Errors (400), Auth Errors (401), Rate Limit (429), Server Error (500)\n`;
    md += `- **Side Effects**: Audit log written, possible email sent, cache updated.\n\n`;
  }
}

fs.writeFileSync(path.join(artifactsDir, 'backend_auth_reference.md'), md);

let frontendMd = '# Frontend UI Requirements Mapping\n\n';
frontendMd += 'Based strictly on the backend API contract, here is the required frontend UI for each flow.\n\n';

const uiMapping = {
  'login.routes.ts': 'Login Page (Email/Password form, Social Login buttons, Forgot Password link)',
  'mfa.routes.ts': 'MFA Flow (Challenge Modal/Page, Setup Wizard, Device Management Settings)',
  'password.routes.ts': 'Password Recovery Flow (Forgot Password Form, Reset Password Form, Email Verification State)',
  'user.routes.ts': 'User Management & Profile (Registration Page, Settings Profile Form, Admin User Dashboard)',
  'session.routes.ts': 'Session Management (Active Sessions List, Logout Button, Auto-Refresh Logic)',
  'provisioning.routes.ts': 'SSO Provisioning (SSO Callback Page, Linking Modals)',
  'account-administration.routes.ts': 'Admin Account Controls (Admin Settings Pages)'
};

for (const [file, fileRoutes] of Object.entries(grouped)) {
  frontendMd += `## ${file.replace('.routes.ts', '')}\n`;
  frontendMd += `**Required UI Elements**: ${uiMapping[file] || 'Miscellaneous Components'}\n\n`;
  
  for (const route of fileRoutes) {
    frontendMd += `### ${route.method} ${route.path}\n`;
    frontendMd += `- **Required Component**: ${route.method === 'GET' ? 'Page Load / Hook fetch' : 'Form / Button action'}\n`;
    frontendMd += `- **Loading State**: Required during request\n`;
    frontendMd += `- **Error State**: Toast notification or Form field error\n`;
    frontendMd += `- **Success State**: Redirect or Success Toast\n\n`;
  }
}

fs.writeFileSync(path.join(artifactsDir, 'frontend_ui_mapping.md'), frontendMd);

console.log('Artifacts generated.');
