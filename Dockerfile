FROM node:24-alpine
RUN mkdir -p /opt/app

WORKDIR /opt/app

COPY package.json .
COPY package-lock.json .
COPY index.ts .
COPY public/ ./public/

RUN npm i

EXPOSE 8080

CMD [ "node", "./index.ts" ]
