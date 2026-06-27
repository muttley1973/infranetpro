'use strict';
// ============================================================
//  server/openapi.js — specifica OpenAPI 3.0 della REST API v1 (read-only).
//
//  Scritta a mano e tenuta in sync con server/routes/api-v1.js. Servita su
//  /api/v1/openapi.json → consumabile da Swagger UI, generatori client, ecc.
//  Funzione (non file statico) così può ereditare info dinamiche se servisse.
// ============================================================

const PROJECT_ID = { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'ID del progetto' };

function buildOpenApi() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'InfraNet Pro API',
      version: '1.0.0',
      description: 'API REST read-only per leggere la documentazione di rete (inventario L1/L2, VLAN, rack) come fonte di verità. Pensata per consumer esterni: Ansible dynamic inventory, dashboard, wiki, automazioni. Autenticazione a token Bearer.',
      license: { name: 'AGPL-3.0-or-later' },
    },
    servers: [{ url: '/', description: 'Host corrente' }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'meta', description: 'Indice e descrizione dell\'API' },
      { name: 'projects', description: 'Progetti e inventario di rete' },
      { name: 'ansible', description: 'Dynamic inventory per Ansible' },
    ],
    paths: {
      '/api/v1': {
        get: {
          tags: ['meta'], summary: 'Indice dell\'API', operationId: 'getApiIndex',
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiIndex' } } } }, 401: { $ref: '#/components/responses/Unauthorized' } },
        },
      },
      '/api/v1/openapi.json': {
        get: {
          tags: ['meta'], summary: 'Specifica OpenAPI (pubblica)', operationId: 'getOpenApi', security: [],
          responses: { 200: { description: 'Documento OpenAPI', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
      '/api/v1/projects': {
        get: {
          tags: ['projects'], summary: 'Elenco progetti (metadati)', operationId: 'listProjects',
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { projects: { type: 'array', items: { $ref: '#/components/schemas/ProjectMeta' } } } } } } },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/api/v1/projects/{id}': {
        get: {
          tags: ['projects'], summary: 'Inventario completo di un progetto', operationId: 'getProjectInventory', parameters: [PROJECT_ID],
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Inventory' } } } },
            401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/projects/{id}/devices': {
        get: {
          tags: ['projects'], summary: 'Solo l\'elenco device', operationId: 'getProjectDevices', parameters: [PROJECT_ID],
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { devices: { type: 'array', items: { $ref: '#/components/schemas/Device' } } } } } } },
            401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/v1/projects/{id}/ansible-inventory': {
        get: {
          tags: ['ansible'], summary: 'Ansible dynamic inventory (formato --list)', operationId: 'getAnsibleInventory', parameters: [PROJECT_ID],
          description: 'Restituisce il JSON nel formato dynamic inventory di Ansible: `_meta.hostvars` (con `ansible_host` = IP) + gruppi per `type_*`, `vlan_*`, `rack_*`, `brand_*`. Solo i device con IP diventano host.',
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/AnsibleInventory' } } } },
            401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Token API mintato dall\'admin (Impostazioni → Token API). Header: Authorization: Bearer inp_…' },
      },
      responses: {
        Unauthorized: { description: 'Token mancante, non valido o revocato', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        NotFound: { description: 'Risorsa non trovata', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' } } },
        ApiIndex: { type: 'object', properties: { name: { type: 'string' }, version: { type: 'string' }, endpoints: { type: 'array', items: { type: 'string' } } } },
        ProjectMeta: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, created_at: { type: 'string' }, updated_at: { type: 'string' } } },
        Vlan: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string', nullable: true }, subnet: { type: 'string', nullable: true }, gateway: { type: 'string', nullable: true }, dns: { type: 'string', nullable: true } } },
        Rack: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string', nullable: true }, sizeU: { type: 'integer', nullable: true } } },
        Device: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string', nullable: true, description: 'Tipo device (switch, router, pc, ap, …)' },
            brand: { type: 'string', nullable: true },
            model: { type: 'string', nullable: true },
            ip: { type: 'string', nullable: true },
            mac: { type: 'string', nullable: true, description: 'MAC normalizzato in UPPER — l\'identità del device' },
            vlan: { type: 'integer', nullable: true, description: 'VLAN derivata dall\'appartenenza IP↔subnet' },
            rack: { type: 'object', nullable: true, properties: { id: { type: 'string' }, name: { type: 'string', nullable: true }, u: { type: 'integer', nullable: true }, sizeU: { type: 'integer', nullable: true } } },
            snmp: { type: 'boolean', description: 'true se il device ha un\'integrazione SNMP configurata (la community NON è esposta)' },
            wireless: { type: 'boolean' },
          },
        },
        Inventory: {
          type: 'object',
          properties: {
            id: { type: 'integer' }, name: { type: 'string', nullable: true }, updated_at: { type: 'string', nullable: true },
            counts: { type: 'object', properties: { devices: { type: 'integer' }, withIp: { type: 'integer' }, snmp: { type: 'integer' } } },
            vlans: { type: 'array', items: { $ref: '#/components/schemas/Vlan' } },
            racks: { type: 'array', items: { $ref: '#/components/schemas/Rack' } },
            devices: { type: 'array', items: { $ref: '#/components/schemas/Device' } },
          },
        },
        AnsibleInventory: {
          type: 'object',
          description: 'Formato Ansible dynamic inventory (--list). Le chiavi diverse da `_meta` e `all` sono gruppi con `{ hosts: [...] }`.',
          properties: {
            _meta: { type: 'object', properties: { hostvars: { type: 'object', additionalProperties: { type: 'object' } } } },
            all: { type: 'object', properties: { children: { type: 'array', items: { type: 'string' } } } },
          },
          additionalProperties: { type: 'object', properties: { hosts: { type: 'array', items: { type: 'string' } } } },
        },
      },
    },
  };
}

module.exports = { buildOpenApi };
