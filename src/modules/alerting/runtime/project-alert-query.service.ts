import type { Pool } from 'pg';
import { AlertRuntimeRepository } from './alert-runtime.repository.js';

export interface ProjectAlertQuery {
  status?: string;
  severity?: string;
  limit: number;
  offset: number;
}

export class ProjectAlertQueryService {
  private readonly runtime: AlertRuntimeRepository;

  constructor(logDb: Pool) {
    this.runtime = new AlertRuntimeRepository(logDb);
  }

  async list(
    organizationId: string,
    projectId: string,
    query: ProjectAlertQuery,
  ): Promise<{ data: Array<Record<string, unknown>>; total: number }> {
    const result = await this.runtime.listProjectAlertEvents(
      organizationId,
      projectId,
      query,
    );
    return result;
  }

  async get(
    organizationId: string,
    projectId: string,
    alertEventId: string,
  ): Promise<Record<string, unknown> | null> {
    return this.runtime.findProjectAlertEventById(organizationId, projectId, alertEventId);
  }
}
