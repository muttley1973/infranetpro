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
ENV INFRANET_PROJECTS_DIR=/data/projects \
    INFRANET_SKINS_DIR=/data/skins \
    INFRANET_USERS_FILE=/data/users.json \
    HOST=0.0.0.0 \
    PORT=8421
RUN mkdir -p /data/projects /data/skins
VOLUME ["/data"]

EXPOSE 8421

# Sonda di salute: /login è pubblica (nessun auth) → risponde 200 quando il server è pronto.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8421)+'/login',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

# tini come PID 1 → inoltra i segnali (Ctrl+C / docker stop), niente processi zombie.
ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
