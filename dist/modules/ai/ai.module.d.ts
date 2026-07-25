import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { AIRepository } from './repository.js';
import { OpenAIProvider } from './openai-client.js';
import { AIAnalyzer } from './analyzer.js';
import { MonitoringChatService } from './chat.js';
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
declare function aiModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerAIModule: typeof aiModule;
export default registerAIModule;
//# sourceMappingURL=ai.module.d.ts.map