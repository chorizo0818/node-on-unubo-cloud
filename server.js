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

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(cookieParser());
app.enable('trust proxy'); // HTTPS への強制リダイレクトのため

const PORT = process.env.PORT || 3000;

let conf = null; // 設定（主にソート順）
const lineLimit = 2; // お題に許容する行数

let userName;
let pw;
let timezoneoffset = -9; // 日本のタイムゾーンJSTは-9

app.get('/', (request, response) => {
  // console.log(request.headers['user-agent']); // UserAgent 表示
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  if(request.cookies['pw']) {
    if(request.cookies['user'] && request.cookies['user'].is_admin) {
      response.redirect('./admin?mode=eval');
    }else{
      response.redirect('./answer?d=' + numToStr(Date.now()));
    }
  }else{
    response.sendFile(path.join(__dirname + '/views/index.html'));
  }
});

app.listen(PORT, () => console.log(`> Ready on http://localhost:${PORT}`));
