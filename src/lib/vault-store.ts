import { create } from "zustand";
import { fetchApi } from "./api";
import { SecretEntry } from "./security-store"; // Reusing the type definition

interface VaultStore {
  items: SecretEntry[];
  loading: boolean;
  error: string | null;

  // Actions
  fetch: () => Promise<void>;
  create: (draft: Omit<SecretEntry, "id" | "createdAt">) => Promise<void>;
  update: (id: string, patch: Partial<SecretEntry>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  fetch: async () => {
    set({ loading: true, error: null });
    try {
      // The API returns the metadata and 'field_names' but not the actual secret contents
      const data = await fetchApi("/api/vault");
      // Map postgres row format to UI SecretEntry format. We can't map 'secret' directly
      // because it's encrypted at rest and not returned by list. The ID is actually `${scope}.${name}`
      // since the DB uses scope+name as the unique pair, or we can use the ID from the db if returned.
      // Looking at vault.mjs: SELECT s.scope, s.name, s.kind, s.meta, s.created_at, s.updated_at...
      // It doesn't select s.id. We will construct a synthetic ID if missing, or use scope.name.
      const mapped = (data.items || []).map((row: any) => {
        // Build metadata
        const meta = row.meta || {};
        return {
          id: `${row.scope}.${row.name}`,
          scope: row.scope,
          name: row.name,
          kind: row.kind || "api_key",
          secret: "", // Cannot read from list endpoint
          note: meta.note || "",
          createdAt: new Date(row.created_at).getTime(),
          // Map kind-specific fields from meta
          headerName: meta.headerName,
          baseUrl: meta.baseUrl,
          username: meta.username,
          loginUrl: meta.loginUrl,
          host: meta.host,
          port: meta.port,
        } as SecretEntry;
      });
      
      set({ items: mapped, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  create: async (draft: any) => {
    try {
      // Build fields payload based on kind
      const fields: Record<string, string> = {};
      const kind = draft.kind || "api_key";
      
      if (kind === "api_key") {
        if (draft.secret) fields["api_key"] = draft.secret;
      } else if (kind === "bearer_token") {
        if (draft.secret) fields["token"] = draft.secret;
      } else if (kind === "basic_auth") {
        if (draft.username) fields["username"] = draft.username;
        if (draft.password) fields["password"] = draft.password;
      } else if (kind === "ssh_password") {
        if (draft.username) fields["username"] = draft.username;
        if (draft.password) fields["password"] = draft.password;
      } else if (kind === "ssh_key") {
        if (draft.username) fields["username"] = draft.username;
        if (draft.privateKey) fields["private_key"] = draft.privateKey;
        if (draft.passphrase) fields["passphrase"] = draft.passphrase;
      } else if (kind === "oauth2_client") {
        if (draft.clientId) fields["client_id"] = draft.clientId;
        if (draft.clientSecret) fields["client_secret"] = draft.clientSecret;
        if (draft.tokenUrl) fields["token_url"] = draft.tokenUrl;
        if (draft.scopes) fields["scope"] = draft.scopes;
      } else if (kind === "aws_access_key") {
        if (draft.accessKeyId) fields["access_key_id"] = draft.accessKeyId;
        if (draft.secretAccessKey) fields["secret_access_key"] = draft.secretAccessKey;
        if (draft.sessionToken) fields["session_token"] = draft.sessionToken;
      } else if (kind === "database_url") {
        if (draft.connectionString) fields["connection_string"] = draft.connectionString;
        if (draft.username) fields["username"] = draft.username;
        if (draft.password) fields["password"] = draft.password;
      } else if (kind === "mtls_cert") {
        if (draft.secret) fields["certificate"] = draft.secret;
        if (draft.privateKey) fields["private_key"] = draft.privateKey;
        if (draft.passphrase) fields["passphrase"] = draft.passphrase;
      } else if (kind === "custom") {
        if (draft.customFields) {
          try {
            const parsed = JSON.parse(draft.customFields);
            Object.assign(fields, parsed);
          } catch (e) {
            console.error("Invalid customFields JSON", e);
          }
        }
      } else {
        if (draft.secret) fields[kind] = draft.secret;
      }

      // Extract non-secret metadata
      const meta: Record<string, any> = { note: draft.note || "" };
      if (draft.headerName) meta["headerName"] = draft.headerName;
      if (draft.baseUrl) meta["baseUrl"] = draft.baseUrl;
      if (draft.loginUrl) meta["loginUrl"] = draft.loginUrl;
      if (draft.host) meta["host"] = draft.host;
      if (draft.port) meta["port"] = draft.port;
      if (draft.region) meta["region"] = draft.region;

      const payload = {
        scope: draft.scope,
        name: draft.name,
        kind,
        meta,
        fields
      };

      await fetchApi("/api/vault", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      
      await get().fetch();
    } catch (err: any) {
      console.error("Failed to create vault secret:", err);
      throw err;
    }
  },

  update: async (id, patch: any) => {
    try {
      // Find the existing item to get scope/name since id = scope.name
      const existing = get().items.find(x => x.id === id);
      if (!existing) throw new Error("Item not found");
      
      const payload: any = {
        scope: patch.scope || existing.scope,
        name: patch.name || existing.name,
        kind: patch.kind || existing.kind,
        meta: {
          note: patch.note ?? existing.note,
          headerName: patch.headerName ?? existing.headerName,
          baseUrl: patch.baseUrl ?? existing.baseUrl,
          loginUrl: patch.loginUrl ?? existing.loginUrl,
          host: patch.host ?? existing.host,
          port: patch.port ?? existing.port,
          region: patch.region ?? existing.region,
        }
      };

      payload.fields = {};
      const kind = payload.kind;

      if (kind === "api_key") {
        if (patch.secret) payload.fields.api_key = patch.secret;
      } else if (kind === "bearer_token") {
        if (patch.secret) payload.fields.token = patch.secret;
      } else if (kind === "basic_auth") {
        if (patch.username) payload.fields.username = patch.username;
        if (patch.password) payload.fields.password = patch.password;
      } else if (kind === "ssh_password") {
        if (patch.username) payload.fields.username = patch.username;
        if (patch.password) payload.fields.password = patch.password;
      } else if (kind === "ssh_key") {
        if (patch.username) payload.fields.username = patch.username;
        if (patch.privateKey) payload.fields.private_key = patch.privateKey;
        if (patch.passphrase) payload.fields.passphrase = patch.passphrase;
      } else if (kind === "oauth2_client") {
        if (patch.clientId) payload.fields.client_id = patch.clientId;
        if (patch.clientSecret) payload.fields.client_secret = patch.clientSecret;
        if (patch.tokenUrl) payload.fields.token_url = patch.tokenUrl;
        if (patch.scopes) payload.fields.scope = patch.scopes;
      } else if (kind === "aws_access_key") {
        if (patch.accessKeyId) payload.fields.access_key_id = patch.accessKeyId;
        if (patch.secretAccessKey) payload.fields.secret_access_key = patch.secretAccessKey;
        if (patch.sessionToken) payload.fields.session_token = patch.sessionToken;
      } else if (kind === "database_url") {
        if (patch.connectionString) payload.fields.connection_string = patch.connectionString;
        if (patch.username) payload.fields.username = patch.username;
        if (patch.password) payload.fields.password = patch.password;
      } else if (kind === "mtls_cert") {
        if (patch.secret) payload.fields.certificate = patch.secret;
        if (patch.privateKey) payload.fields.private_key = patch.privateKey;
        if (patch.passphrase) payload.fields.passphrase = patch.passphrase;
      } else if (kind === "custom") {
        if (patch.customFields) {
          try {
            const parsed = JSON.parse(patch.customFields);
            Object.assign(payload.fields, parsed);
          } catch (e) {
            console.error("Invalid customFields JSON", e);
          }
        }
      } else {
        if (patch.secret) payload.fields[kind] = patch.secret;
      }
      
      // If no fields changed, we don't pass fields back if we don't want to override secrets with empty
      // BUT if we are changing kind, we might need to send fields if they are required.
      // Usually the UI sends the full form state on update if things changed.
      if (Object.keys(payload.fields).length === 0) {
        delete payload.fields;
      }

      await fetchApi("/api/vault", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // Handle rename if scope or name changed (would need to delete old one)
      if ((patch.scope && patch.scope !== existing.scope) || 
          (patch.name && patch.name !== existing.name)) {
        await fetchApi(`/api/vault/${existing.scope}/${existing.name}`, {
          method: "DELETE"
        });
      }

      await get().fetch();
    } catch (err: any) {
      console.error("Failed to update vault secret:", err);
      throw err;
    }
  },

  remove: async (id) => {
    try {
      const existing = get().items.find(x => x.id === id);
      if (!existing) return;
      
      await fetchApi(`/api/vault/${existing.scope}/${existing.name}`, {
        method: "DELETE"
      });
      await get().fetch();
    } catch (err: any) {
      console.error("Failed to delete vault secret:", err);
      throw err;
    }
  },
}));