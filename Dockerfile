FROM node:10.16-alpine as builder

RUN mkdir /app
WORKDIR /app

RUN npm i -g node-pre-gyp@0.14.0 # <=== HERE!

COPY ./package.json ./
COPY ./yarn.lock ./
RUN yarn --frozen-lockfile --no-cache