const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, replacements) {
    const fullPath = path.join(__dirname, '..', filePath);
    if (!fs.existsSync(fullPath)) return;
    let content = fs.readFileSync(fullPath, 'utf8');
    for (const [from, to] of replacements) {
        if (from instanceof RegExp) {
            content = content.replace(from, to);
        } else {
            content = content.split(from).join(to);
        }
    }
    fs.writeFileSync(fullPath, content);
}

// 1. alert-preferences.controller.ts
replaceInFile('src/modules/projects/alerts/preferences/alert-preferences.controller.ts', [
    ['../../shared/middleware/auth.js', '../../../../shared/middleware/auth.js'],
    ['./types.js', '../../types.js'],
    ['./service.js', '../../service.js']
]);

// 2. alert-preferences.repository.ts
replaceInFile('src/modules/projects/alerts/preferences/alert-preferences.repository.ts', [
    ['../../config/database.js', '../../../../config/database.js'],
    ['./utils.js', '../../shared/utils.js'],
    [/row: any/g, 'row: any'], // Implicit any fix
    [/(private map\w+\(row) \)/g, '$1: any)'], 
    [/(private map\w+\(row)/g, '$1: any']
]);

// 3. alert-preferences.service.ts
replaceInFile('src/modules/projects/alerts/preferences/alert-preferences.service.ts', [
    ['../organization/repository.js', '../../../organization/repository.js'],
    ['./service.js', '../../service.js'],
    ['./alert-routes.repository.js', '../routes/alert-routes.repository.js'],
    [/\(r\)/g, '(r: any)']
]);

// 4. alert-preferences.types.ts
replaceInFile('src/modules/projects/alerts/preferences/alert-preferences.types.ts', [
    ['../alerting/types.js', '../../../alerting/types.js']
]);

// 5. alert-routes.controller.ts
replaceInFile('src/modules/projects/alerts/routes/alert-routes.controller.ts', [
    ['../../shared/middleware/auth.js', '../../../../shared/middleware/auth.js'],
    ['./types.js', '../../types.js'],
    ['./service.js', '../../service.js']
]);

// 6. alert-routes.repository.ts
replaceInFile('src/modules/projects/alerts/routes/alert-routes.repository.ts', [
    ['../../config/database.js', '../../../../config/database.js'],
    ['./utils.js', '../../shared/utils.js'],
    [/(private map\w+\(row)/g, '$1: any']
]);

// 7. alert-routes.service.ts
replaceInFile('src/modules/projects/alerts/routes/alert-routes.service.ts', [
    ['../organization/repository.js', '../../../organization/repository.js'],
    ['./service.js', '../../service.js']
]);

// 8. alert-routes.types.ts
replaceInFile('src/modules/projects/alerts/routes/alert-routes.types.ts', [
    ['../alerting/types.js', '../../../alerting/types.js']
]);

// 9. api-key.repository.ts
replaceInFile('src/modules/projects/api-keys/api-key.repository.ts', [
    ['../utils.js', '../shared/utils.js']
]);

// 10. environment.repository.ts
replaceInFile('src/modules/projects/environments/environment.repository.ts', [
    ['../utils.js', '../shared/utils.js']
]);

// 11. projects.module.ts
replaceInFile('src/modules/projects/projects.module.ts', [
    ['./settings.repository.js', './settings/settings.repository.js'],
    ['./usage.repository.js', './usage/usage.repository.js'],
    ['./alert-routes.repository.js', './alerts/routes/alert-routes.repository.js'],
    ['./alert-routes.service.js', './alerts/routes/alert-routes.service.js'],
    ['./alert-preferences.repository.js', './alerts/preferences/alert-preferences.repository.js'],
    ['./alert-preferences.service.js', './alerts/preferences/alert-preferences.service.js'],
    ['./alert-routes.controller.js', './alerts/routes/alert-routes.controller.js'],
    ['./alert-preferences.controller.js', './alerts/preferences/alert-preferences.controller.js']
]);

// 12. repository.ts
replaceInFile('src/modules/projects/repository.ts', [
    ['./utils.js', './shared/utils.js']
]);

// 13. routes.ts
replaceInFile('src/modules/projects/routes.ts', [
    ['./utils.js', './shared/utils.js']
]);

// 14. service.ts
replaceInFile('src/modules/projects/service.ts', [
    ['./settings.repository.js', './settings/settings.repository.js'],
    ['./usage.repository.js', './usage/usage.repository.js'],
    ['./utils.js', './shared/utils.js']
]);

// 15. settings.repository.ts
replaceInFile('src/modules/projects/settings/settings.repository.ts', [
    ['../../config/database.js', '../../../config/database.js'],
    ['./types.js', '../types.js'],
    ['./utils.js', '../shared/utils.js']
]);

// 16. shared/utils.ts
replaceInFile('src/modules/projects/shared/utils.ts', [
    ['./types.js', '../types.js']
]);

// Fix utils.ts possibly undefined errors.
// Looking at TS2532: Object is possibly 'undefined'.
// Let's just blindly use !. or optional chaining in utils.ts by replacing `.` with `?.` in those lines if needed, or we'll just fix it manually after.
// We'll leave the TS2532 for manual inspection.

// 17. usage.repository.ts
replaceInFile('src/modules/projects/usage/usage.repository.ts', [
    ['../../config/database.js', '../../../config/database.js'],
    ['./types.js', '../types.js']
]);

// 18. src/shared/middleware/requireorg.ts
replaceInFile('src/shared/middleware/requireorg.ts', [
    ['../../modules/projects/utils.js', '../../modules/projects/shared/utils.js']
]);

console.log('Fixed imports!');
