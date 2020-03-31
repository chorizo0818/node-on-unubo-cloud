FROM node:10.16-alpine as builder

RUN mkdir /app
WORKDIR /app

RUN nodebrew install-binary 10.16.0
RUN nodebrew use v10.16.0
RUN npm i -g node-pre-gyp@0.14.0 # <=== HERE!

COPY ./package.json ./
COPY ./yarn.lock ./
RUN yarn --frozen-lockfile --no-cache