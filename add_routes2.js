import fs from 'fs';

let p = 'src/modules/projects/routes.ts';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(/\r\n/g, '\n');

c = c.replace(
  /  UpdateProjectBodySchema,\n\} from "\.\/types\.js";/g,
  `  UpdateProjectBodySchema,\n  UpdateProjectSettingsBodySchema,\n} from "./types.js";`
);

let newRoutes = `

  // ── Project Settings & Overview ─────────────────────────────────────────────

  fastify.get(
    "/:projectId/settings",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const settings = await service.getProjectSettings(orgId, projectId, authenticatedUser(request).id);
      return reply.send({ success: true, data: settings });
    }),
  );

  fastify.patch(
    "/:projectId/settings",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const body = UpdateProjectSettingsBodySchema.parse(request.body);
      const settings = await service.updateProjectSettings(orgId, projectId, authenticatedUser(request).id, body, requestMeta(request));
      return reply.send({ success: true, data: settings });
    }),
  );

  fastify.get(
    "/:projectId/overview",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const overview = await service.getProjectOverview(orgId, projectId, authenticatedUser(request).id);
      return reply.send({ success: true, data: overview });
    }),
  );
`;

c = c.replace(
  /  \/\/ ── Environments ────────────────────────────────────────────────────────────/g,
  newRoutes + '\n  // ── Environments ────────────────────────────────────────────────────────────'
);

fs.writeFileSync(p, c);
console.log('Routes added');
