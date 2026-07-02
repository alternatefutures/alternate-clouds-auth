FROM --platform=linux/amd64 node:20-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

RUN pnpm install --frozen-lockfile

RUN pnpm exec prisma generate

COPY . .

# @prisma/client is external since it's dynamically linked
RUN rm -rf dist && pnpm exec esbuild src/index.ts --bundle --platform=node --target=node20 --outfile=dist/index.js --format=esm --packages=external

RUN pnpm prune --prod --ignore-scripts

# Install prisma CLI globally (needed for kubectl exec prisma migrate deploy)
RUN npm install -g prisma@6

# Drop root: run the service as an unprivileged user so an RCE in any dependency
# (this service holds JWT_SECRET, AUTH_INTROSPECTION_SECRET, billing) does not
# start as root inside the container. /app is chowned so runtime + `kubectl exec
# prisma migrate deploy` still work. Listens on 3000 (>1024, no privilege needed).
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const port=process.env.PORT||3000;require('http').get('http://localhost:'+port+'/health',(r)=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "dist/index.js"]
