FROM node:10-slim

RUN mkdir /app
WORKDIR /app

RUN npm i -g node-pre-gyp@0.14.0 # <=== HERE!

COPY ./package.json ./
COPY ./yarn.lock ./
RUN yarn --frozen-lockfile --no-cache