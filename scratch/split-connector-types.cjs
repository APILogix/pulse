const fs = require('fs');
const path = require('path');

const typesPath = path.join(__dirname, '../src/modules/connectors/types.ts');
const corePath = path.join(__dirname, '../src/modules/connectors/core/connector.types.ts');
const deliveryPath = path.join(__dirname, '../src/modules/connectors/delivery/delivery.types.ts');

let content = fs.readFileSync(typesPath, 'utf8');

// We want to extract Delivery related types into delivery.types.ts
// DeliveryStatusSchema, DeliveryStatus, FailureCategorySchema, FailureCategory
// DeliveryResult, DeliveryRow, DeliveryDto, DispatchSummary, ConnectorDeliveryError

const deliveryPattern = /export const DeliveryStatusSchema[\s\S]*?export type DeliveryStatus = [^\n]+;\n|export const FailureCategorySchema[\s\S]*?export type FailureCategory = [^\n]+;\n|export interface DeliveryResult[\s\S]*?\n\}\n|export interface DeliveryRow[\s\S]*?\n\}\n|export interface DeliveryDto[\s\S]*?\n\}\n|export interface DispatchSummary[\s\S]*?\n\}\n|\/\*\* Thrown by connectors[\s\S]*?export class ConnectorDeliveryError[\s\S]*?\n\}\n/g;

let deliveryMatches = content.match(deliveryPattern) || [];

let deliveryTypesContent = `import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { NotificationSeverity, NotificationSeveritySchema } from '../core/connector.types.js';

${deliveryMatches.join('\n')}
`;

let coreTypesContent = content.replace(deliveryPattern, '');
coreTypesContent = coreTypesContent.replace(/import { AppError } from '\.\.\/\.\.\/shared\/errors\/app-error\.js';/, `import { AppError } from '../../../shared/errors/app-error.js';`);
coreTypesContent = coreTypesContent.replace(/import { z } from 'zod';/, `import { z } from 'zod';\nimport { FailureCategory } from '../delivery/delivery.types.js';`);

fs.writeFileSync(deliveryPath, deliveryTypesContent);
fs.writeFileSync(corePath, coreTypesContent);
console.log('Split types!');
