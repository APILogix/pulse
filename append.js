import fs from 'fs';

const content = `
export enum ProjectMemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  DEVELOPER = 'developer',
  VIEWER = 'viewer',
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  organizationId: string;
  role: ProjectMemberRole;
  status: string;
  invitedBy: string | null;
  invitedAt: Date | null;
  joinedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSettings {
  id: string;
  projectId: string;
  organizationId: string;
  retentionDays: number;
  maxEventsPerSecond: number;
  autoArchive: boolean;
  alertingEnabled: boolean;
  ingestionEnabled: boolean;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectOverviewDto {
  project: any;
  settings: ProjectSettings;
  members: ProjectMember[];
  apiKeys: any[];
  stats: any;
}
`;

fs.appendFileSync('src/modules/projects/types.ts', content);
console.log('Appended types.ts');
