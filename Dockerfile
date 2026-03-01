FROM node:20-alpine

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

RUN pnpm exec prisma generate

# Install prisma CLI globally (needed for kubectl exec prisma migrate deploy)
RUN npm install -g prisma@6

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const port=process.env.PORT||3000;require('http').get('http://localhost:'+port+'/health',(r)=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "dist/index.js"]
