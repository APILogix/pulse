import fs from 'fs';
import path from 'path';

const servicePath = path.resolve('./src/modules/projects/service.ts');
let content = fs.readFileSync(servicePath, 'utf8');

// Update apiKey methods in service.ts to use apiKeyRepository instead of repository.
// 1. countActiveApiKeys -> Instead of this, we can just use findByProjectId and count active keys locally.
content = content.replace(/const activeKeys = await this\.repository\.countActiveApiKeys\(projectId, body\.environment\);/g, `const allKeys = await this.apiKeyRepository.findByProjectId(projectId);
    const activeKeys = allKeys.filter(k => k.isActive && k.environment === body.environment).length;`);

// 2. createApiKey
content = content.replace(/const created = await this\.repository\.createApiKey\(\{([\s\S]*?)\}\);/g, 
  `const created = await this.apiKeyRepository.create({$1, organizationId: orgId, status: 'active'});`);

// 3. getApiKey / findApiKeyById
content = content.replace(/const apiKey = await this\.repository\.findApiKeyById\(projectId, apiKeyId\);/g,
  `const keys = await this.apiKeyRepository.findByProjectId(projectId);
    const apiKey = keys.find(k => k.id === apiKeyId);`);

// 4. listActiveApiKeyRecords
content = content.replace(/const keys = await this\.repository\.listActiveApiKeyRecords\(projectId, body\.environment\);/g,
  `const keys = (await this.apiKeyRepository.findByProjectId(projectId)).filter(k => k.isActive && k.environment === body.environment);`);
content = content.replace(/const keys = await this\.repository\.listActiveApiKeyRecords\(projectId, undefined, client\);/g,
  `const keys = (await this.apiKeyRepository.findByProjectId(projectId, client)).filter(k => k.isActive);`);

// 5. revokeApiKey
content = content.replace(/await this\.repository\.revokeApiKey\(projectId, key\.id, userId, "project_deleted", client\);/g,
  `await this.apiKeyRepository.revoke(key.id, projectId, client);`);
content = content.replace(/await this\.repository\.revokeApiKey\(projectId, apiKeyId, userId, reason \?\? null\);/g,
  `await this.apiKeyRepository.revoke(apiKeyId, projectId);`);
content = content.replace(/const revoked = await this\.repository\.revokeApiKey\((.*?)\);/g,
  `await this.apiKeyRepository.revoke($1); const revoked = await this.getApiKey(orgId, projectId, apiKeyId, userId);`);

// 6. findApiKeyRecordById
content = content.replace(/const currentKey = await this\.repository\.findApiKeyRecordById\(projectId, apiKeyId\);/g,
  `const keys = await this.apiKeyRepository.findByProjectId(projectId);
    const currentKey = keys.find(k => k.id === apiKeyId) as any;`);
content = content.replace(/const record = await this\.repository\.findApiKeyRecordById\(projectId, apiKeyId\);/g,
  `const keys = await this.apiKeyRepository.findByProjectId(projectId);
    const record = keys.find(k => k.id === apiKeyId) as any;`);

// 7. updateApiKey - apiKey.repository.ts doesn't have updateApiKey, we need to add it or just skip if we don't need to support updates
// Wait, I can just use a simple query in apiKeyRepository or just use the old this.repository for now if we didn't remove it from repository.ts
// Wait, I didn't remove the api key methods from repository.ts, I just didn't touch them. 

fs.writeFileSync(servicePath, content);
console.log('Patched API keys in service.ts successfully!');
