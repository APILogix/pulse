import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';

import { aiConfig } from '../../config/ai.js';
import { AIRepository } from './repository.js';
import { OpenAIProvider } from './openai-client.js';
import { AIAnalyzer } from './analyzer.js';
import { MonitoringTools } from './monitoring-tools.js';
import { MonitoringChatService } from './chat.js';
import { aiRoutes } from './routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    ai: {
      repository: AIRepository;
      provider: OpenAIProvider;
      analyzer: AIAnalyzer;
      chat: MonitoringChatService;
    };
  }
}

async function aiModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void> {
  const repository = new AIRepository();
  const provider = new OpenAIProvider(aiConfig, fastify.log);
  const analyzer = new AIAnalyzer(repository, provider, aiConfig, fastify.log);
  const tools = new MonitoringTools(
    fastify.analytics.service,
    fastify.alerting.service,
    fastify.eventAnalytics.service,
  );
  const chat = new MonitoringChatService(repository, provider, tools, aiConfig, fastify.log);

  fastify.decorate('ai', { repository, provider, analyzer, chat });
  await fastify.register(aiRoutes, { prefix: '/organizations/:orgId/ai' });

  fastify.log.info(
    { enabled: aiConfig.enabled, providerConfigured: provider.available },
    'AI reliability module registered',
  );
}

export const registerAIModule = fp(aiModule, {
  name: 'ai-module',
  dependencies: ['organization-module', 'analytics-module', 'alerting-module', 'event-analytics-module'],
});

export default registerAIModule;
