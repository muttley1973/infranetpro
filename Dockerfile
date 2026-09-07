# InfraNet Pro — immagine Docker
#   Build:  docker build -t infranetpro .
#   Run:    docker compose up -d        (vedi docker-compose.yml e README → Docker)
FROM node:20-bookworm-slim

# Strumenti runtime per lo scanner di rete (ping/ARP) + init come PID 1 + CA certs.
# net-snmp è puro JS (UDP) → nessun binario; nbtstat/net sono Windows-only e degradano da soli.
RUN apt-get update \
 && apt-get install -y --no-install-recommends iputils-ping net-tools tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# 1) Dipendenze (layer cache). --ignore-scripts: il postinstall (build.js) richiede
#    i sorgenti, qui non ancora copiati → la build la lanciamo esplicitamente al passo 2.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# 2) Sorgenti + build del bundle frontend (esbuild → dist/).
COPY . .
RUN node build.js

# 3) Dati persistenti FUORI da /app (montati come volume → sopravvivono al re-create).
#    Tutti i path sono già configurabili via env nel codice (stesso pattern di PROJECTS_DIR).
#    ⚠️ I SEGRETI (users, token API, config AI/DCIM, session-secret) vanno nel volume,
#    NON in /app: senza questo venivano scritti nell'immagine (layer) e, se presenti
#    nel contesto di build, ci finivano cotti dentro. Restano anche in .dockerignore.
ENV INFRANET_PROJECTS_DIR=/data/projects \
    INFRANET_SKINS_DIR=/data/skins \
    INFRANET_USERS_FILE=/data/users.json \
    INFRANET_API_TOKENS_FILE=/data/api-tokens.json \
    INFRANET_AI_CONFIG_FILE=/data/ai-config.json \
    INFRANET_DCIM_CONFIG_FILE=/data/dcim-config.json \
    INFRANET_SESSION_SECRET_FILE=/data/.session-secret \
    HOST=0.0.0.0 \
    PORT=8421
# 4) Utente NON-root. /data (volume) e /app/data (catalogo rigenerabile a runtime
#    dall'aggiornamento catalogo admin) devono essere scrivibili da `node`; il resto
#    di /app resta di sola lettura per il processo (non può riscrivere il proprio codice).
#    `node` esiste già nell'immagine ufficiale. Il named volume eredita l'owner di /data.
RUN mkdir -p /data/projects /data/skins /app/data && chown -R node:node /data /app/data
VOLUME ["/data"]
USER node

EXPOSE 8421

# Sonda di salute: /login è pubblica (nessun auth) → risponde 200 quando il server è pronto.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8421)+'/login',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

# tini come PID 1 → inoltra i segnali (Ctrl+C / docker stop), niente processi zombie.
ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
