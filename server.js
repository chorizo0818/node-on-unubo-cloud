require('dotenv').config();

const express = require('express');
const router = express.Router();
const app = express();
const bodyParser = require('body-parser');
const path = require('path');
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
  if(request.query.path == 'answer') {
    getAnswer(request, response);
  }else{
    if(request.cookies['pw']) {
      if(request.cookies['user'] && request.cookies['user'].is_admin) {
        response.redirect('./admin?mode=eval');
      }else{
        response.redirect('./answer?d=' + numToStr(Date.now()));
      }
    }else{
      response.sendFile(path.join(__dirname + '/views/index.html'));
    }
  }
});

app.get('/answer', (request, response) => {
  if(request.cookies['pw']) {
    let isAdmin;
    if(request.cookies.user) {
      if(request.cookies.user.is_admin) {
        isAdmin = true;
      }
    }
    if(isAdmin) {
      response.sendFile(__dirname + '/views/answer_admin.html');
    }else{
      response.sendFile(__dirname + '/views/answer.html');
    }
  }else{
    response.redirect('/?jumpto=' + encodeURIComponent(request.url));
  }
});

app.get('/find', function(request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let name = request.query.name;

  MongoClient.connect(mongouri, mongoOptions, (error, client) => {
    const db = client.db(process.env.DB);

    // コレクションの取得
    const collection = db.collection('users');

    // コレクション中で条件に合致するドキュメントを取得
    collection.find({name: {$eq: name}}).toArray((error, documents)=>{
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end(documents.length + '');
      client.close();
    });
  });
});

app.listen(PORT, () => console.log(`> Ready on http://localhost:${PORT}`));
