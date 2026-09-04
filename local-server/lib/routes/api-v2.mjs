import { mountIdentityRoutes } from './identity.mjs';
import { mountDirectoryRoutes } from './directory-api.mjs';
import { mountFederationRoutes } from './federation.mjs';


import { mountModelsRoutes } from './models.mjs';
import { mountAgentsCrudRoutes } from './agents-crud.mjs';
import { mountAgentsExtraRoutes } from './agents-extra.mjs';
import { mountAgentBindingsRoutes } from './agent-bindings.mjs';
import { mountAgentsTemplatesRoutes } from './agents-templates.mjs';
import { mountAgentRunRoute } from './agent-run.mjs';
import { mountThreadRoutes } from './threads.mjs';
import { mountSkillRoutes } from './skills.mjs';
import { mountToolRoutes } from './tools.mjs';
import { mountMcpRoutes } from './mcp.mjs';
import { mountForgeRoutes } from './forge.mjs';
import { mountMetaForgeRoutes } from './meta-forge.mjs';
import { mountWorkflowRoutes } from './workflows.mjs';
import { mountSystemMiscRoutes } from './system-misc.mjs';
import { mountSearchProviderRoutes } from './search-providers.mjs';
import { mountSystemRoutes } from './system-agnostic.mjs';
import { mountSystemProxyRoutes } from './system.mjs';
import { mountBackupRoutes } from './backup.mjs';
import { mountTelemetryRoutes } from './telemetry.mjs';
import { mountAdaptersRoutes } from './adapters.mjs';
import { mountAdapterDictionariesRoutes } from './adapter-dictionaries.mjs';
import { mountTemplateAssignmentsRoutes } from './template-assignments.mjs';
import { mountVisionServiceRoutes } from './vision-service.mjs';
import { mountVoiceProfilesRoutes } from './voice-profiles.mjs';
import { mountVaultRoutes } from './vault.mjs';
import { mountPlannersRoutes } from './planners-crud.mjs';
import { mountSecurityPoliciesRoutes } from './security-policies.mjs';
import { mountPythonRoutes } from './python-crud.mjs';
import { mountTargetsRoutes } from './targets-crud.mjs';
import { mountMemoryRoutes } from './memory.mjs';
import { mountApprovalRoutes } from './approvals.mjs';
import { mountCveRoutes } from './cve.mjs';
import { mountRegistryRoutes } from './registry.mjs';

import { mountIdentityGroupsRoutes } from './identity-groups.mjs';
import { mountIdentityTemplatesRoutes } from './identity-templates.mjs';
import { mountIdentityRolesRoutes } from './identity-roles.mjs';
import { mountSystemConfigRoutes } from './system-config.mjs';
import { mountFleetServicesRoutes } from './fleet-services.mjs';
import { mountKnowledgeSpacesRoutes } from './knowledge-spaces.mjs';
import { mountKnowledgeConfigRoutes } from './knowledge-state.mjs';
import { mountKnowledgeIngestRoutes } from './knowledge-ingest.mjs';
import { mountKnowledgeRetrieveRoutes } from './knowledge-retrieve.mjs';
import { mountKnowledgeSyncRoutes } from './knowledge-sync.mjs';
import { mountKnowledgeMaintenanceRoutes } from './knowledge-maintenance.mjs';
import { mountKnowledgeAuditRoutes } from './knowledge-audit.mjs';
import { mountWebhooksCrudRoutes } from './webhooks-crud.mjs';
import { mountRagFoldersRoutes } from "./rag-folders.mjs";
import { mountRagDbStatsRoute } from './rag-db-stats.mjs';
import { mountRagOpsRoutes } from './rag-ops.mjs';
import { mountProvidersRoutes } from './providers.mjs';
import { mountSystemCertsRoutes } from './system-certs.mjs';
import { mountMailTimeRoutes } from './mail-time.mjs';
import { mountSiemRoutes } from './siem-api.mjs';
import { mountCapabilityRoutes } from './capabilities.mjs';
import { mountChatOrchestrateRoutes } from './chat-orchestrate.mjs';
import { mountReportingRoutes } from './reporting.mjs';

async function safeMount(name, mountFn, app, deps) {
  try {
    console.log(`[API Gateway] Mounting ${name}...`);
    // Standardize to pass (app, deps) as separate arguments
    await mountFn(app, deps);
    console.log(`[API Gateway] ✅ ${name} mounted successfully.`);
  } catch (error) {
    console.error(`[API Gateway] 💥 Critical error mounting ${name}: ${error.message}`);
    console.error(error.stack);
  }
}

export async function mountApiRoutes(app, deps) {
  if (!deps) {
    console.error('[API Gateway] ❌ mountApiRoutes called without deps object!');
    return;
  }

  console.log('[API Gateway] Starting route mounting sequence...');

  await safeMount('Identity', mountIdentityRoutes, app, deps);
  await safeMount('Directory API', mountDirectoryRoutes, app, deps);
  await safeMount('Federation (OIDC/SAML)', mountFederationRoutes, app, deps);

  await safeMount('Identity Groups', mountIdentityGroupsRoutes, app, deps);
  await safeMount('Identity Templates', mountIdentityTemplatesRoutes, app, deps);
  await safeMount('Identity Roles', mountIdentityRolesRoutes, app, deps);
  await safeMount('System Config', mountSystemConfigRoutes, app, deps);
  await safeMount('System Providers', mountProvidersRoutes, app, deps);
  await safeMount('System Certs', mountSystemCertsRoutes, app, deps);
  await safeMount('Mail and Time', mountMailTimeRoutes, app, deps);
  await safeMount('SIEM Forwarder', mountSiemRoutes, app, deps);
  await safeMount('Fleet Services', mountFleetServicesRoutes, app, deps);

  await safeMount('Models', mountModelsRoutes, app, deps);
  await safeMount('Agents', mountAgentsCrudRoutes, app, deps);
  await safeMount('Agents Extra', mountAgentsExtraRoutes, app, deps);
  await safeMount('Agent Bindings', mountAgentBindingsRoutes, app, deps);
  await safeMount('Agent Templates', mountAgentsTemplatesRoutes, app, deps);
  await safeMount('Agent Run', mountAgentRunRoute, app, deps);
  await safeMount('Threads', mountThreadRoutes, app, deps);
  await safeMount('Skills', mountSkillRoutes, app, deps);
  await safeMount('Tools', mountToolRoutes, app, deps);
  await safeMount('MCP', mountMcpRoutes, app, deps);
  await safeMount('Forge', mountForgeRoutes, app, deps);
  await safeMount('MetaForge', mountMetaForgeRoutes, app, deps);
  await safeMount('Workflows', mountWorkflowRoutes, app, deps);
  await safeMount('Knowledge Spaces', mountKnowledgeSpacesRoutes, app, deps);
  await safeMount('Knowledge State', mountKnowledgeConfigRoutes, app, deps);
  await safeMount('Knowledge Ingest', mountKnowledgeIngestRoutes, app, deps);
  await safeMount('Knowledge Retrieve', mountKnowledgeRetrieveRoutes, app, deps);
  await safeMount('Knowledge Sync', mountKnowledgeSyncRoutes, app, deps);
  await safeMount('Knowledge Maintenance', mountKnowledgeMaintenanceRoutes, app, deps);
  await safeMount('Knowledge Audit', mountKnowledgeAuditRoutes, app, deps);
  await safeMount('Webhooks CRUD', mountWebhooksCrudRoutes, app, deps);
  await safeMount('RAG Folders', mountRagFoldersRoutes, app, deps);
  await safeMount('RAG DB Stats', mountRagDbStatsRoute, app, deps);
  await safeMount('RAG Ops', mountRagOpsRoutes, app, deps);
  await safeMount('Search Providers', mountSearchProviderRoutes, app, deps);
  await safeMount('System Misc', mountSystemMiscRoutes, app, deps);
  await safeMount('System Runtime', mountSystemRoutes, app, deps);
  await safeMount('System Proxy', mountSystemProxyRoutes, app, deps);
  await safeMount('Backup', mountBackupRoutes, app, deps);
  await safeMount('Telemetry', mountTelemetryRoutes, app, deps);
  await safeMount('Adapters', mountAdaptersRoutes, app, deps);
  await safeMount('Adapter Dicts', mountAdapterDictionariesRoutes, app, deps);
  await safeMount('Template Assignments', mountTemplateAssignmentsRoutes, app, deps);
  await safeMount('Vision', mountVisionServiceRoutes, app, deps);
  await safeMount('Voice', mountVoiceProfilesRoutes, app, deps);
  await safeMount('Vault', mountVaultRoutes, app, deps);
  await safeMount('Planners', mountPlannersRoutes, app, deps);
  await safeMount('Security Policies', mountSecurityPoliciesRoutes, app, deps);
  await safeMount('Python Runtimes', mountPythonRoutes, app, deps);
  await safeMount('Targets', mountTargetsRoutes, app, deps);
  await safeMount('Memory', mountMemoryRoutes, app, deps);
  await safeMount('Approvals', mountApprovalRoutes, app, deps);
  await safeMount('CVE Feed', mountCveRoutes, app, deps);
  await safeMount('Registry', mountRegistryRoutes, app, deps);
  await safeMount('Capabilities', mountCapabilityRoutes, app, deps);
  await safeMount('Chat Orchestrate', mountChatOrchestrateRoutes, app, deps);
  await safeMount('Reporting & Analytics', mountReportingRoutes, app, deps);

  console.log('[API Gateway] Route mounting sequence completed.');
}
