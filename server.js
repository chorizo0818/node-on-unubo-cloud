require('dotenv').config();

const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
// const httpsRedirect = require('parse-express-https-redirect'); // HTTPS に強制リダイレクトすべきか
const httpRequest = require('request');
const url = require('url');
const mimelib = require('mimelib');
const jschardet = require('jschardet');
const iconv = require('iconv-lite');
const MongoClient = require('mongodb').MongoClient;
const ObjectID = require('mongodb').ObjectID;
const mongouri = 'mongodb+srv://'+process.env.USER+':'+process.env.PASS+'@'+process.env.MONGOHOST+'?retryWrites=true';
const mongoOptions = {useNewUrlParser:true, useUnifiedTopology:true };

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.listen(PORT, () => console.log(`> Ready on http://localhost:${PORT}`));
