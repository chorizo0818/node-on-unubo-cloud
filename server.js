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
app.use(express.cookieParser());
app.use(app.router);
app.enable('trust proxy'); // HTTPS への強制リダイレクトのため

const PORT = process.env.PORT || 3000;

let conf = null; // 設定（主にソート順）
const lineLimit = 2; // お題に許容する行数

let userName;
let pw;
let timezoneoffset = -9; // 日本のタイムゾーンJSTは-9


// パスワード暗号化用
const hashed = (password) => {
  let hash = crypto.createHmac('sha512', password)
  hash.update(password)
  let value = hash.digest('hex')
  return value;
}

// app.get('*', function(request, response){
//   response.send('メンテナンス')
// });

app.get("/status", function(req, res) {
  res.send('OK');
});

// http://expressjs.com/en/starter/basic-routing.html
app.get('/', function (request, response) {
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

app.get('/answer', function (request, response) {
  // console.log(request);
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
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

app.post('/answer', function(request, response) {
  if(request.cookies['pw']) {
    let isAdmin;
    if(request.cookies.user) {
      if(request.cookies.user.is_admin) {
        isAdmin = true;
      }
    }
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let json = JSON.parse(data);
      let answers = json.answers;
      let userId = request.cookies.user._id;
      let odaiId = json.odai_id;
      let date = Date.now();

      /*
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        const db = client.db(process.env.DB);
        const odaiCol = db.collection('odais');
        odaiCol.findOne({id:{$eq:odaiId}},(err2, odai)=>{
          console.log(odai.sentence);
        });
      });
      */

      let oid = null;
      try{
        oid = new ObjectID(odaiId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
      }catch(e){
      }

      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        const db = client.db(process.env.DB);
        const odaiCol = db.collection('odais');
        odaiCol.findOne({$or:[{_id:{$eq:odaiId}}, {_id:{$eq:oid}}]},(err2, odai)=>{
          if(!err2) {
            let available = true; // 募集中かどうか
            // available = (odai.date_release < Date.now() && Date.now() < odai.date_close);
            available = (odai.date_release < Date.now());
            if(odai.date_close) {
              available = (available && Date.now() < odai.date_close);
            }
            const confCol = db.collection('config');
            confCol.findOne({allow_after_closed:{$ne:null}}, (err_conf, conf)=>{
              let allow_after_closed = false; // 締め切り後の投稿を許可するか
              if(!err_conf && conf) {
                allow_after_closed = conf.allow_after_closed;
              }

              if(available || allow_after_closed || isAdmin) {
                const collection = db.collection('answers');

                collection.find({}).toArray((err3, documents)=>{
                  let data = [];
                  for(let i in answers) {
                    let obj = {};
                    obj.sentence = answers[i].sentence;
                    obj.img = answers[i].img;
                    obj.user_id = userId;
                    obj.odai_id = odaiId;
                    obj.date = date;
                    data.push(obj);
                  }
                  // コレクションにドキュメントを挿入（複数であれば insertMany）
                  collection.insertMany(data, (err4, result) => {
                    if(!err4) {
                      response.sendStatus(200);
                    }else{
                      response.status(500);
                      response.send('Server Error.\n内部エラーです。申し訳ありません。');
                    }
                    client.close();
                  });
                });
              }else{
                response.status(400);
                response.send('このお題は現在募集中ではありません。');
                // response.send('this Odai is not open currently.');
                client.close();
              }
            });
          }else{
            response.status(400);
            response.send('Odai Not Found.\nお題が見つかりませんでした。');
            client.close();
          }
        });
      });

    });
  }else{
    response.sendStatus(400);
  }
});

app.get('/getsingleanswer', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let ansId = parseInt(request.query.ansId);
  let userDb = request.cookies['user'];
  let userId = userDb._id;
  if(userDb) delete userDb.pw;

  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }

  if(request.cookies['pw']) {
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);

      // コレクションの取得
      const ansCol = db.collection('answers');

      // コレクション中で条件に合致するドキュメントを取得
      ansCol.findOne({
        id:{$eq:ansId}
      },(err1, ans)=>{
        const odaiCol = db.collection('odais');
        odaiCol.findOne({id:{$eq:ans.odai_id}}, (err2, odai)=>{
          ans.odai = odai.sentence;
          
          // 管理者以外は自分の回答のみ表示可能
          if(!isAdmin && ans.user_id != userId) {
            ans.sentence = 'Error\nNot Your Answer.';
            delete ans.user_id;
            delete ans.voted;
            delete ans.rank;
            delete ans.odai_id;
            delete ans.date;
          }

          if(odai.date_close) {
            const userCol = db.collection('users');
            userCol.findOne({id:{$eq:ans.user_id}}, (err3, user)=>{
              if(user) {
                delete user.pw;
                ans.user = user;
              }
              response.send(ans);
              client.close();
            });
          }else{
            response.send(ans);
            client.close();
          }
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

// IDで自分の回答を参照する
app.get('/getanswer', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let ansId = request.query.ansId;

  let myId;
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user._id)  myId = request.cookies.user._id;
    if(request.cookies.user.is_admin) isAdmin = true;
  }

  if(request.cookies['pw']) {
    MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
      if(err1) {
        response.status(500);
        response.send('Server Error.\n申し訳ありません、データベースとの接続に失敗しました。');
        return;
      }
      const db = client.db(process.env.DB);
      const ansCol = db.collection('answers');

      let oid = null;
      try{
        oid = new ObjectID(ansId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
      }catch(e){
      }

      ansCol.findOne({$or:[{_id:{$eq:ansId}}, {_id:{$eq:oid}}]}, (err2, answer)=>{
        if(err2) {
          response.status(500);
          response.send('Server Error.\n申し訳ありません、サーバーエラーです。');
          return;
        }else if(!answer){
          response.status(500);
          response.send('Server Error.\n回答が見つかりませんでした。1');
          return;
        }
        const odaiCol = db.collection('odais');

        let oid = null;
        try{
          oid = new ObjectID(answer.odai_id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
        }catch(e){}

        odaiCol.findOne({$or:[{_id:{$eq:answer.odai_id}}, {_id:{$eq:oid}}]}, (err3, odai)=>{
          if(err3){
            response.status(500);
            response.send('Server Error.\n申し訳ありません、サーバーエラーです。');
            return;
          }else if(!odai){
            response.status(500);
            response.send('Server Error.\n申し訳ありません、サーバーエラーです。');
            return;
          }
          let available = true; // 募集中かどうか
          available = (odai.date_release < Date.now());
          if(odai.date_close) {
            available = (available && Date.now() < odai.date_close);
          }
          const confCol = db.collection('config');
          confCol.findOne({allow_after_closed:{$ne:null}}, (err_conf, conf)=>{
            let allow_after_closed = false; // 締め切り後の投稿を許可するか
            if(!err_conf && conf) {
              allow_after_closed = conf.allow_after_closed;
            }

            if(myId == answer.user_id || isAdmin) {
              if(available || allow_after_closed) {
                answer.editable = true;
              }
              if(!isAdmin) delete answer.trashed;
              response.send(answer);
            }else{
              response.status(400);
              response.send('Bad Request.\n参照できるのは自分の回答だけです。');
            }
            client.close();
          });
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.get('/mail', function (request, response) {
  // console.log(request.headers['user-agent']);
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  // ログインなしでアクセス可能に
  response.sendFile(__dirname + '/views/mail_send.html');
});

app.get('/mailbox', function (request, response) {
  let ua = request.headers['user-agent'];
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies['pw'] && isAdmin) {
    if(ua.indexOf('Android') != -1 || ua.indexOf('iPhone') != -1 || ua.indexOf('iPad') != -1) {
      response.sendFile(__dirname + '/views/mail_receive_mobi.html');
    }else{
      response.sendFile(__dirname + '/views/mail_receive.html');
    }
  }else{
    response.redirect('/?jumpto=' + encodeURIComponent(request.url));
  }
});

app.get('/graph', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  if(request.cookies['pw']) {
    response.sendFile(__dirname + '/views/graph.html');
  }else{
    response.redirect('/?jumpto=' + encodeURIComponent(request.url));
  }
});

app.get('/graph_inner', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  if(request.cookies['pw']) {
    response.sendFile(__dirname + '/views/graph_inner.html');
  }else{
    response.redirect('/?jumpto=' + encodeURIComponent(request.url));
  }
});

app.get('/graph_outer', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  if(request.cookies['pw']) {
    response.sendFile(__dirname + '/views/graph_outer.html');
  }else{
    response.redirect('/?jumpto=' + encodeURIComponent(request.url));
  }
});

app.get('/getanswers', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  let targetId = request.query.odaiId;
  let voted = eval(request.query.voted);
  // let sortby = request.query.sortby;
  let order = request.query.order;

  if(request.cookies['pw'] && isAdmin) {
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);

      // コレクションの取得
      const collection = db.collection('answers');

      // コレクション中で条件に合致するドキュメントを取得
      if(voted != undefined) {
        let condition = {
          private:{$ne:true},
          odai_id:{$eq:targetId},
          voted:{$ne:undefined}
        }
        if(request.query.trashed) {
          condition.trashed = {$eq:true};
        }else{
          condition.trashed = {$ne:true};
        }
        collection.find(condition).sort({voted:-1}).toArray((error, documents)=>{
          const userCol = db.collection('users');
          userCol.find().toArray((err, users)=>{
            for(var i in documents) {
              for(var j in users) {
                if(documents[i].user_id == users[j]._id) {
                  delete users[j].pw;
                  documents[i].user = users[j];
                  break;
                }
              }
            }
          let onlyZero = true; // 投票が無い
          for(let i in documents) {
            if(documents[i].voted) onlyZero = false;
          }
          if(onlyZero) {
            for(let i in documents) {
              delete documents[i].rank;
            }
          }
          let votedArray = [];
          let normalArray = []; // いる？
          for(let i in documents) {
            if(documents[i].voted && documents[i].voted != 0) {
              votedArray.push(documents[i]);
            }else{
              normalArray.push(documents[i]);
            }
          }
          normalArray.sort(function(a,b){
            if(a._id<b._id) return -1;
            if(a._id > b._id) return 1;
            return 0;
          });
          //Array.prototype.push.apply(votedArray, normalArray);
          votedArray = votedArray.concat(normalArray);
          if(onlyZero) {
            votedArray.sort(function(a,b){
              if(a.idx < b.idx) return -1;
              if(a.idx > b.idx) return 1;
              return 0;
            });
          }
            response.send(votedArray);
            client.close();
          });
          // response.send(documents);
        });
      }else{
        let condition = {
          private:{$ne:true},
          odai_id:{$eq:targetId},
          voted:{$eq:voted}
        }
        if(request.query.trashed) {
          condition.trashed = {$eq:true};
        }else{
          condition.trashed = {$ne:true};
        }
        collection.find(condition).toArray((error, documents)=>{
          const userCol = db.collection('users');
          userCol.find().toArray((err, users)=>{
            const confCol = db.collection('config');
            if(!order) {
              order = 'date.1';
              confCol.findOne({}, (error, conf)=>{
                if(conf) {
                  order = conf.order;
                  confCol.updateOne({order:{$ne:null}}, {$set:{order: order}},(err0, resultConf)=>{
                    for(var i in documents) {
                      for(var j in users) {
                        if(documents[i].user_id == users[j]._id) {
                          delete users[j].pw;
                          documents[i].user = users[j];
                        }
                      }
                    }
                    let rule = order.split('.');
                    documents.sort(function(a,b){
                      if(a[rule[0]] < b[rule[0]]) return -1 * rule[1];
                      if(a[rule[0]] > b[rule[0]]) return 1 * rule[1];
                      return 0;
                    });

                    response.send(documents);
                    client.close();
                  });
                }else{
                  confCol.updateOne({order:{$ne:null}}, {$set:{order: order}},(err0, resultConf)=>{
                    for(var i in documents) {
                      for(var j in users) {
                        if(documents[i].user_id == users[j]._id) {
                          delete users[j].pw;
                          documents[i].user = users[j];
                        }
                      }
                    }
                    let rule = order.split('.');
                    documents.sort(function(a,b){
                      if(a[rule[0]] < b[rule[0]]) return -1 * rule[1];
                      if(a[rule[0]] > b[rule[0]]) return 1 * rule[1];
                      return 0;
                    });

                    response.send(documents);
                    client.close();
                  });
                }
              });
            }else{
              confCol.updateOne({order:{$ne:null}}, {$set:{order: order}},(err0, resultConf)=>{
                for(var i in documents) {
                  for(var j in users) {
                    if(documents[i].user_id == users[j]._id) {
                      delete users[j].pw;
                      documents[i].user = users[j];
                    }
                  }
                }
                let rule = order.split('.');
                documents.sort(function(a,b){
                  if(a[rule[0]] < b[rule[0]]) return -1 * rule[1];
                  if(a[rule[0]] > b[rule[0]]) return 1 * rule[1];
                  return 0;
                });

                response.send(documents);
                client.close();
              });
            }
          });
          // response.send(documents);
        });
      }
      // client.close();
    });
  }else{
    response.status(400);
    response.send('Bad Request.\n管理者のみに許可される機能です。');
  }
});

app.get('/getansnum', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  let targetId = request.query.odaiId;

  if(request.cookies['pw'] && isAdmin) {
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);
      const collection = db.collection('answers');
      let condition = {
        private:{$ne:true},
        odai_id:{$eq:targetId},
      }
      collection.find(condition).sort({voted:-1}).toArray((error, documents)=>{
        if(error) {
          response.status(500);
          response.send('Server Error.\nサーバエラーです。申し訳ありません。');
        }else{
          response.status(200);
          response.send(documents.length + '');
        }
      });
    });
  }else{
    response.status(400);
    response.send('Bad Request.\n管理者のみに許可される機能です。');
  }
});

app.get('/getuseranswers', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let odaiId = request.query.odaiId;
  // let userId = parseInt(request.query.userId);
  let userId = request.cookies.user ? request.cookies.user._id : null;
  let userDb = request.cookies['user'];
  if(userDb) delete userDb.pw;

  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(!isAdmin || !userId) userId = userDb._id;

  if(request.cookies['pw']) {
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);

      // コレクションの取得
      const collection = db.collection('answers');

      // コレクション中で条件に合致するドキュメントを取得
        collection.find({
          odai_id:{$eq:odaiId}
        }).sort({voted:-1}).toArray((error, documents)=>{
          let evaluated = false;
          for(let i in documents) {
            if(documents[i].voted != undefined && documents[i].voted > 0) {
              evaluated = true;
              break;
            }
          }
          // console.log(evaluated);
          const odaiCol = db.collection('odais');

          let oid = null;
          try{
            oid = new ObjectID(odaiId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
          }catch(e){
          }
          odaiCol.find({$or:[{_id:{$eq:odaiId}}, {_id:{$eq:oid}}]}).toArray((err, odais)=>{
            // odais[0].date_close += 1 * 24 * 60 * 60 * 1000;
            let answers = [];
            for(let i in documents) {
              if(documents[i].user_id == userId) {
                answers.push(documents[i]);
              }
            }
            let votedArray = [];
            let normalArray = [];
            if(odais[0])
              if(!isAdmin && !odais[0].date_close) {
                answers.sort(function(a,b){
                  if(a.date<b.date) return -1;
                  if(a.date > b.date) return 1;
                  return 0;
                });
              }
              for(let i in answers) {
                delete answers[i].trashed; // ゴミ箱情報削除

                if(odais[0]) {
                  if(!isAdmin && (!odais[0].date_close || Date.now() < odais[0].date_close || !evaluated)) {
                    delete answers[i].rank;
                    delete answers[i].voted;
                  }
                  if(answers[i].voted || answers[i].voted == 0) {
                    votedArray.push(answers[i]);
                  }else{
                    normalArray.push(answers[i]);
                  }
                }
              }
              votedArray.sort(function(a,b){
                if(a.rank<b.rank) return -1;
                if(a.rank > b.rank) return 1;
                return 0;
              });
              normalArray.sort(function(a,b){
                if(a._id<b._id) return -1;
                if(a._id > b._id) return 1;
                return 0;
              });
              //Array.prototype.push.apply(votedArray, normalArray);
              response.send(votedArray.concat(normalArray));
              client.close();
          });
        });
    });
  }else{
    response.sendStatus(400);
  }
});

app.get('/getuserodais', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let userId = request.query.userId;

  let userDb = request.cookies['user'];

  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(!isAdmin || !userId) userId = userDb._id;
  if(request.cookies['pw']) {
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);

      // コレクションの取得
      const collection = db.collection('odais');

      // コレクション中で条件に合致するドキュメントを取得
      collection.find({
        user_id:{$eq:userId}
      }).sort({date_release:-1}).toArray((error, documents)=>{
        let released = [];
        let notReleased = [];
        for(let i in documents) {
          if(documents[i].date_release) {
            released.push(documents[i]);
          }else{
            notReleased.push(documents[i]);
          }
        }
        notReleased.sort(function(a,b){
          if(a.date<b.date) return -1;
          if(a.date > b.date) return 1;
          return 0;
        });
        response.status(200);
        response.send(released.concat(notReleased));
        client.close();
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.post('/updateconf', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let order = JSON.parse(data).order;
      MongoClient.connect(mongouri, mongoOptions, (error, client) => {
        const db = client.db(process.env.DB);
        const confCol = db.collection('config');

        confCol.updateOne({order:{$ne:order}}, {$set:{order: order}},(error, results)=>{
          if(error) console.log(error.message);
          response.sendStatus(200);
          client.close();
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.get('/crud', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let target = request.query.target;

    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);
      const col = db.collection(target);

      col.find({}).sort({'id':1}).toArray((error, documents)=>{
        // for(let key in documents) {
        //   if(documents[key]._id) delete documents[key]._id;
        // }
        response.send(documents);
        client.close();
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.post('/crud', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    let target = request.query.target;

    request.on('end', function() {
      MongoClient.connect(mongouri, mongoOptions, (error, client) => {
        const db = client.db(process.env.DB);
        const col = db.collection(target);

        col.remove({},(err1, result1) => {
          data = JSON.parse(data); // 一旦バックスラッシュを除去
          let obj = JSON.parse(data);

          if(!err1 && obj.length) {
            // col.insertMany
            col.insertMany(obj, (err2, result2) => {
              if(err2) {
                response.sendStatus(400);
              }else{
                response.sendStatus(200);
              }
              client.close();
            });
          }else{
            response.sendStatus(200);
            client.close();
          }
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.get('/backup', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let backupJson = {};

    MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
      const db = client.db(process.env.DB);

      const colConf = db.collection('config');
      colConf.find({}).toArray((err2, conf)=>{
        if(err2) {
          response.status(500);
          response.send('Server Error.\n内部エラーです。申し訳ありません。');
          client.close();
          return;
        }else{
          // for(let key in conf) {
          //   if(conf[key]._id) delete conf[key]._id;
          // }
          backupJson.config = conf;
          
          const colUsers = db.collection('users');
          colUsers.find({}).sort({'id':1}).toArray((err3, users)=>{
            if(err3) {
              response.status(500);
              response.send('Server Error.\n内部エラーです。申し訳ありません。');
              client.close();
              return;
            }else{
              // for(let key in users) {
              //   if(users[key]._id) delete users[key]._id;
              // }
              backupJson.users = users;

              const colOdais = db.collection('odais');
              colOdais.find({}).sort({'id':1}).toArray((err4, odais)=>{
                if(err4) {
                  response.status(500);
                  response.send('Server Error.\n内部エラーです。申し訳ありません。');
                  client.close();
                  return;
                }else{
                  // for(let key in odais) {
                  //   if(odais[key]._id) delete odais[key]._id;
                  // }
                  backupJson.odais = odais;
                  
                  const colAnswers = db.collection('answers');
                  colAnswers.find({}).sort({'id':1}).toArray((err5, answers)=>{
                    if(err5) {
                      response.status(500);
                      response.send('Server Error.\n内部エラーです。申し訳ありません。');
                      client.close();
                      return;
                    }else{
                      // for(let key in answers) {
                      //   if(answers[key]._id) delete answers[key]._id;
                      // }
                      backupJson.answers = answers;

                      let hashedStr = hashed(JSON.stringify(backupJson));

                      let nowDate = new Date();
                      nowDate.setHours(nowDate.getHours() + 9); // 9時間ずれてる
                      response.set('Content-Type', 'application/octet-stream');
                      response.attachment('backup_' + getNowYMD(nowDate)+ '.json');
                      response.status(200);
                      response.send({hashed:hashedStr, data:JSON.stringify(backupJson)}); // stringify いる？
                      client.close();
                      return;
                    }
                  });
                }
              });
            }
          });
        }
      });
    });
  }else{
    response.status(400);
    response.send('ログイン中の管理者のみ実行可能です。');
  }
});

app.post('/restore', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });

    request.on('end', function() {
      data = JSON.parse(data); // 一旦バックスラッシュを除去
      let obj = null;
      try{
        obj = JSON.parse(data);
      }catch(e){
        response.status(400);
        response.send('Bad Request.\nJSONの形式が不正です。');
      }

      let checkSum = obj.hashed;
      if(checkSum != hashed(obj.data)) {
        response.status(400);
        response.send('Bad Request.\n改ざんを検知しました。');
      }else{
        let backupJson = JSON.parse(obj.data);
        let numOfCol = 0; // コレクションの数
        let count = 0;
        for(let key in backupJson) {
          numOfCol++;
        }

        const userIds = [];
        const odaiIds = [];
        const ansIds  = []; // いるか？
        for(let i in backupJson.users) {
          try{
            backupJson.users[i]._id = new ObjectID(backupJson.users[i]._id);
          }catch(e){}
          userIds.push({before:backupJson.users[i].id});
          delete backupJson.users[i].id;
        }
        for(let i in backupJson.odais) {
          try{
            backupJson.odais[i]._id = new ObjectID(backupJson.odais[i]._id);
          }catch(e){}
          odaiIds.push({before:backupJson.odais[i].id});
          delete backupJson.odais[i].id;
        }
        for(let i in backupJson.answers) {
          try{
            backupJson.answers[i]._id = new ObjectID(backupJson.answers[i]._id);
          }catch(e){}
          ansIds.push({before:backupJson.answers[i].id});
          delete backupJson.answers[i].id;
        }

        MongoClient.connect(mongouri, mongoOptions, async (error, client) => {
          if(error) {
            response.status(500);
            response.send('Database connection Error.\nデータベース接続に失敗しました。申し訳ありません。');
          }else{
            const db = client.db(process.env.DB);

            const err = '';

            const userCol = db.collection('users');

            // ユーザを削除
            const userDeleteCondition = {};
            const userDeleteResult = await deleteMany(userCol, userDeleteCondition).catch(function(error){
              // ここでレスポンスを返して return してはいけない
              err = error;
            });
            if(err) {
              response.status(500);
              response.send(err);
              client.close();
              return;
            }

            // ユーザを復元
            const userInsertResult = await insertMany(userCol, backupJson.users).catch(function(error){
              // ここでレスポンスを返して return してはいけない
              err = error;
            });
            if(err) {
              response.status(500);
              response.send(err);
              client.close();
              return;
            }

            // user_id を更新（マップを基に、古ければ）
            for(let i in userIds) {
              userIds[i].after = userInsertResult.insertedIds[i] + '';
            }
            for(let i in userIds) {
              for(let j in backupJson.odais) {
                if(backupJson.odais[j].user_id == userIds[i].before) {
                  backupJson.odais[j].user_id = userIds[i].after;
                }
              }
              for(let j in backupJson.answers) {
                if(backupJson.answers[j].user_id == userIds[i].before) {
                  backupJson.answers[j].user_id = userIds[i].after;
                }
              }
            }

            const odaiCol = db.collection('odais');

            // お題を削除
            const odaiDeleteCondition = {};
            const odaiDeleteResult = await deleteMany(odaiCol, odaiDeleteCondition).catch(function(error){
              // ここでレスポンスを返して return してはいけない
              err = error;
            });
            if(err) {
              response.status(500);
              response.send(err);
              client.close();
              return;
            }

            // お題を復元
            const odaiInsertResult = await insertMany(odaiCol, backupJson.odais).catch(function(error){
              // ここでレスポンスを返して return してはいけない
              err = error;
            });
            if(err) {
              response.status(500);
              response.send(err);
              client.close();
              return;
            }

            // odai_id を更新（マップを基に、古ければ）
            for(let i in odaiIds) {
              odaiIds[i].after = odaiInsertResult.insertedIds[i] + '';
            }
            for(let i in odaiIds) {
              for(let j in backupJson.answers) {
                if(backupJson.answers[j].odai_id == odaiIds[i].before) {
                  backupJson.answers[j].odai_id = odaiIds[i].after;
                }
              }
            }

            const ansCol = db.collection('answers');

            // 回答を削除
            const ansDeleteCondition = {};
            const ansDeleteResult = await deleteMany(ansCol, ansDeleteCondition).catch(function(error){
              // ここでレスポンスを返して return してはいけない
              err = error;
            });
            if(err) {
              response.status(500);
              response.send(err);
              client.close();
              return;
            }

            // 回答を復元
            const ansInsertResult = await insertMany(ansCol, backupJson.answers).catch(function(error){
              // ここでレスポンスを返して return してはいけない
              err = error;
            });
            if(err) {
              response.status(500);
              response.send(err);
              client.close();
              return;
            }

            const confCol = db.collection('config');

            // 回答を削除
            const confDeleteCondition = {};
            const confDeleteResult = await deleteMany(confCol, confDeleteCondition).catch(function(error){
              // ここでレスポンスを返して return してはいけない
              err = error;
            });
            if(err) {
              response.status(500);
              response.send(err);
              client.close();
              return;
            }

            // 回答を復元
            const confInsertResult = await insertMany(confCol, backupJson.config).catch(function(error){
              // ここでレスポンスを返して return してはいけない
              err = error;
            });
            if(err) {
              response.status(500);
              response.send(err);
              client.close();
              return;
            }


            response.sendStatus(200);
            client.close();
          }
        });
      }
    });
  }else{
    response.status(400);
    response.send('ログイン中の管理者のみ実行可能です。');
  }
});



function find(col, condition) {
  return new Promise((resolve, reject) =>{
    col.find(condition).toArray(function(error, documents) {
      if(error) {
        reject(error);
      }else{
        resolve(documents);
      }
    });
  });
}

function insertMany(col, documents) {
  return new Promise((resolve, reject) =>{
    col.insertMany(documents, (error, result) => {
      if(error) {
        reject(error);
      }else{
        resolve(result); // たぶん result.insertedIds 配列を使う
      }
    });
  });
}

function deleteMany(col, condition) {
  return new Promise((resolve, reject) =>{
    col.deleteMany(condition, (error, result)=>{
      if(error) {
        reject(error);
      }else{
        resolve(result);
      }
    });
  });
}

// operation: {$set:{updateDate: Date.now()}} とか
function updateMany(col, condition, operation) {
  return new Promise((resolve, reject) =>{
    col.updateMany(condition, operation,(error, result)=>{
      if(error) {
        reject(error);
      }else{
        resolve(result);
      }
    });
  });
}

function updateOne(col, condition, operation) {
  return new Promise((resolve, reject) =>{
    col.updateOne(condition, operation,(error, result)=>{
      if(error) {
        reject(error);
      }else{
        resolve(result);
      }
    });
  });
}

app.get('/editodai', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin){
    response.sendFile(__dirname + '/views/admin/edit_odai.html');
  } else {
    response.redirect('/?jumpto=' + encodeURIComponent(request.url));
  }
});

app.get('/sendodai', function(request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  if(request.cookies['pw']) {
    let isAdmin;
    if(request.cookies.user) {
      if(request.cookies.user.is_admin) {
        isAdmin = true;
      }
    }
    if(isAdmin) {
      response.sendFile(__dirname + '/views/sendodai_admin.html');
    }else{
      response.sendFile(__dirname + '/views/sendodai.html');
    }
  }else{
    response.redirect('/?jumpto=' + encodeURIComponent(request.url));
  }
});

app.post('/sendodai', function(request, response) {
  if(request.cookies['pw']) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let json = JSON.parse(data);
      if(json.mode == 'make') {
        let odais = json.odais;
        let createdBy = json.user_id;
        let date = Date.now();

        // console.log(request.header('Content-Type'));
        //for(let key in odais) {
        //  insertOdai({sentence: odais[key], createdby: createdby, date: date.getTime()});
        //}
        
        MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
          if(err1) {
            response.status(500);
            response.send('Database connection Error.\nデータベース接続に失敗しました。申し訳ありません。');
          }else{
            const db = client.db(process.env.DB);
            const collection = db.collection('odais');

            let data = [];
            for(let i in odais) {
              let obj = {};
              obj.sentence = odais[i].sentence;

              if(obj.sentence.split('\n').length > lineLimit) {
                response.status(400);
                response.send(lineLimit + '行を超えるお題が含まれています');
                return;
              }

              if(odais[i].img) obj.img = odais[i].img;
              obj.user_id = createdBy;
              obj.date = date;
              data.push(obj);
            }
            // コレクションにドキュメントを挿入（複数であれば insertMany）
            collection.insertMany(data, (err3, result) => {
              if(!err3) {
                response.status(200);
                response.sendFile(__dirname + '/views/sendodai.html');
              }else{
                response.status(500);
                response.send('Database Update Error.\n更新に失敗しました。申し訳ありません。');
              }
              client.close();
            });
          }
        });
        // console.log(odais + ':' + createdby + ':' + date.getTime());
      }else{
        response.sendStatus(200);
      }
    });
  }else{
    response.redirect('/?jumpto=' + encodeURIComponent(request.url));
  }
});

// ログイン
app.post('/login', function (request, response) {
  if(!request.body.userName) {
    response.redirect('./?errcode=1');
  }else{
    userName = request.body.userName;
    pw = hashed(request.body.pw);
    response.cookie('userName', userName);
    response.cookie('pw', pw);
    let jumpto = request.body.jumpto;
    // response.sendStatus(200);
    
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);

      // コレクションの取得
      const collection = db.collection('users');

      // コレクション中で条件に合致するドキュメントを取得
      collection.find({
        name: {$eq: userName},
        pw: {$eq: pw}
      }).toArray((error, documents)=>{
        if(documents.length == 0) {
          // ユーザが存在しない場合は追加、存在する場合はログイン失敗
          // コレクションの取得
          const collection = db.collection('users');

          // コレクション中で条件に合致するドキュメントを取得
          collection.find({name: {$eq: userName}}).toArray((error, documents)=>{
            if(documents.length == 0) {
              pw = undefined;
              response.clearCookie('pw');
              response.redirect('./confirm?mode=mkuser&jumpto=' + jumpto);
              client.close();
            }else if(documents.length == 1) {
              // ログイン失敗
              pw = undefined;
              response.clearCookie('pw');
              response.redirect('./?errcode=0&jumpto=' + jumpto);
              client.close();
            }
          });
        }else if(documents.length){
          // ログイン成功
          response.cookie('user', documents[documents.length - 1]);
          if(documents[documents.length - 1].is_admin) {
            const confCol = db.collection('config');

            confCol.findOne({
              order:{$ne:null}
            },(err1, result)=>{
              if(err1 || !result){
                conf = {order:'date.1'};
                confCol.insertOne(conf, (error, result) => {
                  client.close();
                });
              }else{
                conf = result;
                client.close();
              }
              if(decodeURIComponent(jumpto)){
                response.redirect(decodeURIComponent(jumpto));
              }else{
                response.redirect('./admin?mode=eval');
              }
            });
          } else {
            if(decodeURIComponent(jumpto)) {
              response.redirect(decodeURIComponent(jumpto));
            }else{
              response.redirect('./answer?d=' + numToStr(Date.now()));
            }
          }
        }else{
          response.sendStatus(500);
          client.close();
        }
      });
    });
  }
});

app.get('/confirm', function(request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let mode = request.query.mode;
  if(mode == 'mkuser') {
    response.sendFile(__dirname + '/views/confirm.html');
  }else{
    response.redirect('./');
  }
});

app.get('/import', function(request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  response.sendFile(__dirname + '/views/import.html');
});

// app.post('/import', function(request, response) {
//   let odais = request.body.odais.split('\r\n');;
//   let data = [];
//   for(let i in odais) {
//     let odai = odais[i].trim();
//     let params = odai.split(',');
//     let id = parseInt(params[0]);
//     let userId = parseInt(params[1]);
//     let releaseYear = parseInt(params[2].split('/')[0]);
//     let releaseMonth = parseInt(params[2].split('/')[1]) - 1;
//     let releaseDay = parseInt(params[2].split('/')[2]);
//     let releaseDate = new Date(releaseYear, releaseMonth, releaseDay).getTime();
//     let closeDate = undefined;
//     if(params[3] != 'undefined') {
//       let closeYear = parseInt(params[3].split('/')[0]);
//       let closeMonth = parseInt(params[3].split('/')[1]) - 1;
//       let closeDay = parseInt(params[3].split('/')[2]);
//       closeDate = new Date(closeYear, closeMonth, closeDay).getTime();
//     }
//     let sentence = params[4];
//     let postedDate = Date.now();
//     if(closeDate) {
//       data.push({id:id,user_id:userId, date:postedDate, date_release:releaseDate, date_close:closeDate, sentence:sentence});
//     }else{
//       data.push({id:id,user_id:userId, date:postedDate, date_release:releaseDate, sentence:sentence});
//     }
//   }
//   MongoClient.connect(mongouri, mongoOptions, (error, client) => {
//     const db = client.db(process.env.DB);

//     // コレクションの取得
//     const collection = db.collection('odais');

//     // コレクション中で条件に合致するドキュメントを取得
//     collection.insertMany(data, (error, result) => {
//       client.close();
//     });
//   });
//   response.sendStatus(200);
// });


/*
app.get('/del_all', function(request, response) {
  MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
    const db = client.db(process.env.DB);
    const collection = db.collection('users');
    collection.remove({},(err, results) => {
      if(err) {
        response.status(500);
        response.send(JSON.stringify(err, null, ' '));
      }else{
        response.sendStatus(200);
      }
    });
  });
});
*/

// 確認後の実行
app.post('/exec', function(request, response) {
  let location = request.body.location;
  let generation = request.body.generation;
  let gender = request.body.gender;
  response.cookie('location', location);
  response.cookie('generation', generation);
  response.cookie('gender', gender);
  
  if(!request.body.pw) {
    response.redirect('./confirm?mode=mkuser&errcode=0');
  }else{
    let pw = hashed(request.body.pw);
    response.cookie('pw', pw);
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);

      // コレクションの取得
      const collection = db.collection('users');

      // コレクション中で条件に合致するドキュメントを取得
      collection.find().toArray((err, users)=>{
        for(let i in users) {
          if(users[i].name == request.cookies['userName']) {
            response.writeHead(400, { 'Content-Type': 'text/plain' });
            response.end('{errorCode:0, message:\'User already exists.\'}');
            client.close();
            return;
          }
        }
        collection.find({name: {$eq: request.cookies['userName']}}).toArray((error, documents)=>{
          if(documents && documents.length != 0) {
            response.writeHead(400, { 'Content-Type': 'text/plain' });
            response.end('{errorCode:0, message:\'User already exists.\'}');
            client.close();
            return;
          }else{
            // コレクションの取得
            const collection = db.collection('users');

            // コレクション中で条件に合致するドキュメントを取得
            collection.find({}).toArray((error, documents)=>{
              if(!error) {
                let date = Date.now();
                let userObj = {name: request.cookies['userName'], location: location, generation: generation, gender: gender, date_regist: date, pw: pw};
                if(!documents || !documents.length) userObj.is_admin = true; // 最初のユーザなら管理者

                const collection = db.collection('users');
                collection.insertOne(userObj, (err1, result) => {
                  if(!err1) {
                    response.cookie('user', userObj);
                    response.redirect('./');
                  }else{
                    response.status(500);
                    response.send('Server Error.\n内部エラーです。申し訳ありません。');
                  }
                  client.close();
                });
              }else{
                client.close();
                response.status(500);
                response.send('Server Error.\n内部エラーです。申し訳ありません。');
              }
            });
          }
        });
      });
    });
  }
});

// ログアウト
app.get('/logout', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  userName = undefined;
  pw = undefined;
  response.clearCookie('userName');
  response.clearCookie('location');
  response.clearCookie('generation');
  response.clearCookie('gender');
  response.clearCookie('user');
  response.clearCookie('pw');
  response.redirect('/');
});

// ユーザを取得（管理者以外は自分の情報のみ） TODO 大丈夫か？
app.get('/getuser', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  let targetId = request.query.userId;
  let userDb = request.cookies['user'];
  if(userDb) delete userDb.pw;
  if(targetId && isAdmin) {
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);

      // コレクションの取得
      const collection = db.collection('users');

      let oid = null;
      try{
        oid = new ObjectID(targetId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
      }catch(e){}
      collection.findOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, (error, user)=>{
        if(user) {
          delete user.pw;
          response.send(user);
        }else{
          response.send(null);
        }
        client.close();
      });
    });
  } else {
    if(request.cookies.pw) {
      response.send(userDb);
    }else{
      // response.sendStatus(400);
      response.sendStatus(200); // ログインしてなくても OK を返す
    }
  }
});

app.get('/getusers', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin){
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);

      // コレクションの取得
      const collection = db.collection('users');
      collection.find({}).sort({'id':1}).toArray((error, documents)=>{
        if(!error) {
          for(var i in documents) {
            delete documents[i].pw;
          }
          response.status(200);
          response.send(documents);
        }else{
          response.status(500);
          response.send('Server Error.\n内部エラーです。申し訳ありません。');
        }
        client.close();
      });
    });
  } else {
    response.sendStatus(400);
  }
});

app.get('/getconf', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin){
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);

      const collection = db.collection('config');

      collection.findOne({}, (error, conf)=>{
        if(!conf) {
          conf = {order: 'user_id.1', allow_after_closed: false};
          collection.insertOne(conf, (error, results)=>{
            response.send(conf);
            client.close();
          });
        }else{
          response.send(conf);
          client.close();
        }
      });
    });
  } else {
    response.sendStatus(400);
  }
});

// IDで自分の回答を参照する
app.get('/getodai', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let odaiId = request.query.odaiId;

  let myId;
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user._id)  myId = request.cookies.user._id;
    if(request.cookies.user.is_admin) isAdmin = true;
  }

  if(request.cookies['pw']) {
    MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
      if(err1) {
        response.status(500);
        response.send('Server Error.\n申し訳ありません、データベースとの接続に失敗しました。');
        return;
      }
      const db = client.db(process.env.DB);
      const odaiCol = db.collection('odais');

      let oid = null;
      try{
        oid = new ObjectID(odaiId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
      }catch(e){}
      odaiCol.findOne({$or:[{_id:{$eq:odaiId}}, {_id:{$eq:oid}}]}, (err2, odai)=>{
        if(err2) {
          response.status(500);
          response.send('Server Error.\n申し訳ありません、サーバーエラーです。0');
          client.close();
          return;
        }else if(!odai){
          response.status(500);
          response.send('Server Error.\n回答が見つかりませんでした。2\n' + odaiId);
          client.close();
          return;
        }

        let available = true; // 募集中かどうか
        available = (odai.date_release < Date.now());
        if(odai.date_close) {
          available = (available && Date.now() < odai.date_close);
        }

        const confCol = db.collection('config');
        confCol.findOne({allow_after_closed:{$ne:null}}, (err_conf, conf)=>{
          let allow_after_closed = false; // 締め切り後の投稿を許可するか
          if(!err_conf && conf) {
            allow_after_closed = conf.allow_after_closed;
          }

          if(myId == odai.user_id || isAdmin) {
            const userCol = db.collection('users');
            userCol.findOne({_id:{$eq:odai.user_id}}, (err4, user)=>{
              if(user) delete user.pw;
              odai.user = user;
              response.send(odai);
              client.close();
            });
          }else{
            if(odai.date_release) {
              const userCol = db.collection('users');
              userCol.findOne({_id:{$eq:odai.user_id}}, (err4, user)=>{
                if(user) delete user.pw;
                odai.user = user;
                response.send(odai);
                client.close();
              });
            }else{
              response.status(400);
              response.send('Bad Request.\n参照できる公開前のお題は自分のものだけです。');
            }
          }
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.get('/getodais', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw){
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);

      // コレクションの取得
      const collection = db.collection('odais');

      // コレクション中で条件に合致するドキュメントを取得
      collection.find(
        {date_release:{$lt:Date.now()}}
      ).sort({'date_release':-1}).toArray((error, documents)=>{
        const userCol = db.collection('users');
        userCol.find().toArray((err, users)=>{
          for(var i in documents) {
            if((documents[i].date_release < Date.now() && documents[i].date_close > Date.now()) || (documents[i].date_release < Date.now() && !documents[i].date_close)) {
              documents[i].open = true;
            }
            for(var j in users) {
              if(documents[i].user_id == users[j]._id) {
                delete users[j].pw;
                documents[i].user = users[j];
              }
              if(documents[i].videoEditedBy == users[j]._id || documents[i].videoEditedBy == users[j].id) {
                documents[i].videoEditedBy = users[j].name;
              }
              
              if(documents[i].date_close) {
                let date_close = documents[i].date_close;
                let rest = date_close - Date.now();
                let dateStr = '';
                let days = Math.floor(rest/(1000*60*60*24)); // 日

                // 残り時間
                if(rest > 0) {
                  rest -= days*(1000*60*60*24);
                  let hours = Math.floor(rest/(1000*60*60)); // 時間
                  rest -= hours*(1000*60*60);
                  let minutes = Math.floor(rest/(1000*60)); // 分
                  rest -= minutes*(1000*60);
                  let seconds = Math.floor(rest/1000); // 秒

                  if(days) dateStr += days + '日と';
                  if(hours) dateStr += hours + '時間';
                  if(minutes) dateStr += minutes + '分';
                  if(seconds) dateStr += seconds + '秒';

                  documents[i].rest = dateStr;
                }
              }
            }
          }
          client.close();
          if(request.query.targetId) {
            for(let i in documents) {
              if(documents[i]._id == request.query.targetId) {
                response.send(documents[i]);
                return;
              }
            }
            response.sendStatus(404);
          }else{
            response.send(documents);
          }
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

// 募集中のお題一覧を取得する
app.get('/getopen', function(request, response){
  if(!request.cookies || !request.cookies['pw']) {
    response.sendStatus(500);
    return;
  }

  MongoClient.connect(mongouri, mongoOptions, (error, client) => {
    const db = client.db(process.env.DB);
    const collection = db.collection('odais');

    const condition = {$or:[{$and:[{date_release:{$lt:Date.now()}}, {date_close:{$gt:Date.now()}}]}, {$and:[{date_release:{$lt:Date.now()}}, {date_close:{$eq:undefined}}]}]};

    // コレクション中で条件に合致するドキュメントを取得
    collection.find(condition).toArray((error, odais)=>{
      if(!error) {
        response.send(odais);
      }else{
        console.log(error);
        response.sendStatus(500);
      }
      client.close();
    });
  });
});

/*
app.get('/initodais', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let now = new Date().getTime();
  MongoClient.connect(mongouri, mongoOptions, (error, client) => {
    const db = client.db(process.env.DB);
    const collection = db.collection('odais');

    // コレクション中で条件に合致するドキュメントを取得
    collection.find({}).sort({'id':-1}).toArray((error, documents)=>{
      let updateCount = 0;
      for(let i in documents) {
        // collection.updateOne({id:{$eq:parseInt(documents[i].id)}}, {$set:{date: 0, id: parseInt(i)+1}},(err, results)=>{
        // if(err) console.log(documents[i].sentence + ':' + documents[i].id);
        //   updateCount++;
        //   if(updateCount == documents.length) {
        //     response.send(documents);
        //     client.close();
        //   }
        // });
        collection.updateMany({}, {$set:{date: parseInt(documents[i].id) + 0}},(err, results)=>{
          response.send(documents);
          client.close();
        });
        // console.log(now);
      }
    });
  });
});
*/

/*
app.get('/getcurrentodai', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  MongoClient.connect(mongouri, mongoOptions, (error, client) => {
    const db = client.db(process.env.DB);

    // コレクションの取得
    const collection = db.collection('odais');

    // コレクション中で条件に合致するドキュメントを取得
    collection.find(
      {
        date_release:{$lt:Date.now()},
        date_close:{$eq:undefined}
      }
    ).sort({'date_release':-1}).toArray((error, documents)=>{
      const userCol = db.collection('users');
      userCol.find().toArray((err, users)=>{
        for(var i in documents) {
          for(var j in users) {
            if(documents[i].user_id == users[j].id) {
              delete users[j].pw;
              documents[i].user = users[j];
              break;
            }
          }
        }
        response.send(documents[0]);
        client.close();
      });
      // response.send(documents[0]);
    });
    // client.close();
  });
});
*/

app.get('/getallodais', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin){
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);

      // コレクションの取得
      const collection = db.collection('odais');

      // コレクション中で条件に合致するドキュメントを取得
      collection.find({trashed:{$ne:true}}).sort({'date_release':-1}).toArray((error, documents)=>{
        const userCol = db.collection('users');
        userCol.find().toArray((err, users)=>{
          for(var i in documents) {
            for(var j in users) {
              if(documents[i].user_id == users[j]._id) {
                delete users[j].pw;
                documents[i].user = users[j];
                break;
              }
            }
          }
          /*
          let odai_released = [];
          let odai_notyet = [];
          for(var i in documents) {
            if(documents.date_release) {
              odai_released.push(documents[i]);
            } else {
              odai_notyet.push(documents[i]);
            }
          }
          odai_notyet.sort(function(a,b){
            if(a.id < b.id) return -1;
            if(a.id > b.id) return 1;
            return 0;
          });
          documents = odai_released.concat(odai_notyet);
          */
          response.send(documents);
          client.close();
        });
        // response.send(documents);
      });
      // client.close();
    });
  }else{
    response.sendStatus(400);
  }
});

app.post('/admin', function(request, response) {
  response.redirect(request.url);
});

app.get('/admin', function(request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let pw = request.cookies.pw;
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(pw && isAdmin) {
    let mode = request.query.mode
    switch(mode) {
      case 'selectOdai':
        response.sendFile(__dirname + '/views/admin/shutsudai.html');
        break;
      case 'eval':
        response.sendFile(__dirname + '/views/admin/hyouka.html');
        break;
      case 'eval_old':
        response.sendFile(__dirname + '/views/admin/hyouka_old.html');
        break;
      case 'crud':
        response.sendFile(__dirname + '/views/admin/crud.html');
        break;
      case 'backup':
        response.sendFile(__dirname + '/public/backup.html');
        break;
      case 'makepw':
        response.sendFile(__dirname + '/views/admin/makepw.html');
        break;
      case 'trash':
        response.sendFile(__dirname + '/views/admin/trash.html');
        break;
      default:
        response.redirect('./');
               }
  }else{
    response.redirect('/?jumpto=' + encodeURIComponent(request.url));
  }
});

app.get('/nextodais', function(request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let pw = request.cookies.pw;
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(pw && isAdmin) {
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);

      // コレクションの取得
      const collection = db.collection('odais');

      // コレクション中で条件に合致するドキュメントを取得
      collection.find({$and:[{date_release:{$eq:undefined}}, {trashed:{$ne:true}}]}).sort({'date':1}).toArray((error, documents)=>{
        for(var i in documents) {
          if(documents[i].sentence)
            documents[i].sentence = documents[i].sentence.replace('<', '&lt;').replace('>', '&gt;');
        }
        const userCol = db.collection('users');
        userCol.find({}).toArray((err, users)=>{
          for(var i in users) {
            if(users[i].name)
              users[i].name = users[i].name.replace('<', '&lt;').replace('>', '&gt;');
            if(users[i].location)
              users[i].location = users[i].location.replace('<', '&lt;').replace('>', '&gt;');
            if(users[i].generation)
              users[i].generation = users[i].generation.replace('<', '&lt;').replace('>', '&gt;');
            if(users[i].gender)
              users[i].gender = users[i].gender.replace('<', '&lt;').replace('>', '&gt;');
          }
          for(var i in documents) {
            for(var j in users) {
              if(documents[i].user_id == users[j]._id) {
                delete users[j].pw;
                documents[i].user = users[j];
                break;
              }
            }
          }
          client.close();
          documents.sort(function(a,b){
            if(a.starred && !b.starred) return -1;
            if(!a.starred && b.starred) return 1;
            if(a.date < b.date) return -1;
            if(a.date > b.date) return 1;
            return 0;
          });
          response.send(documents);
        });
        // response.send(documents);
      });
      // client.close();
    });
  }else{
    response.sendStatus(400);
  }
});

app.post('/setnext', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let next = JSON.parse(data).next;
      let closeElse = JSON.parse(data).close_else;
      if(next) {
        MongoClient.connect(mongouri, mongoOptions, (error, client) => {
          const db = client.db(process.env.DB);
          // コレクションの取得
          const collection = db.collection('odais');

          let oid = null;
          try{
            oid = new ObjectID(next); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
          }catch(e){}

          if(closeElse) {
            collection.updateMany({
              $and:[
                {id:{$ne:next}},
                {_id:{$ne:next}},
                {_id:{$ne:oid}},
                {date_close:{$eq:undefined}},
                {date_release:{$ne:undefined}}
              ]
            }, {$set:{date_close: Date.now()}},(error, results)=>{
              collection.updateOne({$or:[{_id:{$eq:next}}, {_id:{$eq:oid}}]}, {$set:{date_release: Date.now()}},(error, results)=>{
                client.close();
              });
            });
          }else{
            collection.updateOne({$or:[{_id:{$eq:next}}, {_id:{$eq:oid}}]}, {$set:{date_release: Date.now()}},(error, results)=>{
              client.close();
            });
          }
        });
      }
      response.sendStatus(200);
    });
  }else{
    response.sendStatus(400);
  }
});

app.post('/setnine', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let selected = JSON.parse(data).selected;
      if(selected.length) {
        MongoClient.connect(mongouri, mongoOptions, (error, client) => {
          const db = client.db(process.env.DB);
          // コレクションの取得
          const collection = db.collection('answers');

          collection.find({
            voted:{$ne:undefined}
          }).toArray(async (err1, answers)=>{
            if(!err1) {
              let num = answers.length;
              for(let i in selected) {

                let oid = null;
                try{
                  oid = new ObjectID(selected[i]); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
                }catch(e){}
                await addToNine(collection, {$or:[{_id:{$eq:selected[i]}}, {_id:{$eq:oid}}]}, (parseInt(i) + num)).catch(function(e){
                  console.log(e);
                });
              }
              client.close();
            }else{
              client.close();
            }
          });
        });
      }
      response.sendStatus(200);
    });
  }else{
    response.sendStatus(400);
  }
});

// 9 選に追加
function addToNine(colAnswer, condition, idx) {
  return new Promise(function(resolve, reject){
    colAnswer.updateOne(condition, {$set:{voted: 0, idx: idx}},(error, results)=>{
      if(error) {
        reject(error);
      }else{
        resolve(results);
      }
    });
  });
}

app.post('/updateorder', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let obj = JSON.parse(data).order;
      if(obj.length) {
        MongoClient.connect(mongouri, mongoOptions, (error, client) => {
          const db = client.db(process.env.DB);
          // コレクションの取得
          const collection = db.collection('answers');

          const tasks = [];
          for(let i in obj) {
            let oid = null;
            try{
              oid = new ObjectID(obj[i].id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
            }catch(e){}

            tasks.push(updateOne(collection, {$or:[{_id:{$eq:obj[i].id}}, {_id:{$eq:oid}}]}, {$set:{idx: obj[i].idx}}));
          }
          Promise.all(tasks).then(function (receivedList) {
            response.sendStatus(200);
          }).catch(function(error){
            response.status(500);
            response.send(error);
          }).then(function(){
            // console.log(tasks[0].then, tasks[0].catch, tasks[0].finally);
            // console.log('finally is not defined.');
            client.close();
          });
        });
      }
    });
  }else{
    response.sendStatus(400);
  }
});

app.get('/result', function(request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw) {
    if(isAdmin) {
      response.sendFile(__dirname + '/views/result_admin.html');
    }else{
      response.redirect('/'); // 一般ユーザは回答画面にリダイレクト
    }
  }else{
    response.sendStatus(400);
  }
});

app.get('/display', function(request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw) {
    //if(isAdmin) {
      response.sendFile(__dirname + '/views/display.html');
    //}else{
    //  response.sendStatus(400);
    //}
  }else{
    response.sendStatus(400);
  }
});

app.get('/draw', function(request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  // let ua = request.headers['user-agent'];
  // if(ua.indexOf('Android') != -1 || ua.indexOf('iPhone') != -1 || ua.indexOf('iPad') != -1) {
  //   response.sendFile(__dirname + '/views/draw.html');
  // }else{
  //   response.sendFile(__dirname + '/views/draw_cursor.html');
  // }
  response.sendFile(__dirname + '/views/draw_toolbox.html');
});

app.post('/update_odai', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let odaiObj = JSON.parse(data);
      MongoClient.connect(mongouri, mongoOptions, (error, client) => {
        const db = client.db(process.env.DB);
        // コレクションの取得
        const collection = db.collection('odais');

        let updateObj = {user_id:odaiObj.user_id};
        let releaseDate;
        let closeDate;
        if(odaiObj.date_release) {
          // console.log(odaiObj.date_release);
          releaseDate = new Date(odaiObj.date_release).getTime();
          releaseDate = releaseDate + (timezoneoffset * 60 - new Date().getTimezoneOffset()) * 60000;
          updateObj.date_release = releaseDate;
        }
        if(odaiObj.date_close) {
          closeDate = new Date(odaiObj.date_close).getTime();
          closeDate = closeDate + (timezoneoffset * 60 - new Date().getTimezoneOffset()) * 60000;
          updateObj.date_close = closeDate;
        }

        let oid = null;
        try{
          oid = new ObjectID(odaiObj.odai_id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
        }catch(e){}

        let updateCondition = {$set:{date_release:updateObj.date_release, date_close:updateObj.date_close}};
        if(!updateObj.date_release && !updateObj.date_close) {
          updateCondition = {$unset:{date_release:1, date_close:1}};
        }else if(updateObj.date_release && !updateObj.date_close) {
          updateCondition = {$set:{date_release:updateObj.date_release}, $unset:{date_close:1}};
        }else if(!updateObj.date_release && updateObj.date_close) {
          updateCondition = {$set:{date_close:updateObj.date_close}, $unset:{date_release:1}};
        }
console.log(updateObj);
        collection.updateOne({$or:[{_id:{$eq:odaiObj.odai_id}}, {_id:{$eq:oid}}]}, updateCondition,(error, results)=>{
          client.close();
          if(error) {
            response.sendStatus(500);
          }else{
            response.sendStatus(200);
          }
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.get('/editprofile', function(request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  if(request.cookies['pw']) {
    let isAdmin;
    if(request.cookies.user) {
      if(request.cookies.user.is_admin) {
        isAdmin = true;
      }
    }
    if(isAdmin) {
      response.sendFile(__dirname + '/views/edit_profile_admin.html');
    }else{
      response.sendFile(__dirname + '/views/edit_profile.html');
    }
  }else{
    response.redirect('/?jumpto=' + encodeURIComponent(request.url));
  }
});

// TODO 名前の変更履歴とかも持ちたい
app.post('/editprofile', function(request, response) {
  let name = request.body.username;
  let location = request.body.location;
  let generation = request.body.generation;
  let gender = request.body.gender;
  let pw = hashed(request.body.pw);

  if(!name) {
    response.redirect('editprofile?errcode=0&d=' + Date.now());
  }else{
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);
      const collection = db.collection('users');
      // TODO 名前の重複チェック
      let userDb = request.cookies['user'];
      const oid = new ObjectID(userDb._id);
      collection.find({
        name:{$eq:name}, // 入力された名前で
        _id:{$ne:oid} // IDが違う
      }).toArray((err1, users)=>{
        if(err1) {
          response.status(500);
          response.send('Server Error\n内部エラーです。申し訳ありません。');
        }else if(users.length){
          // 入力された名前でIDが違うユーザが存在したら
          // response.status(400);
          // response.send('Bad Request\nそのラジオネームは使えません。');
          response.redirect('/editprofile?errcode=1&name=' + encodeURIComponent(name) + '&d=' + Date.now());
        }else{
          if(request.body.pw) {
            collection.updateOne({name:{$eq:request.cookies['userName']}}, {$set:{name:name, location:location, generation:generation, gender:gender, pw:pw}},(error, results)=>{
              if(!error) {
                response.cookie('userName', name);
                response.cookie('pw', pw);
                if(userDb) {
                  userDb.name = name;
                  userDb.location = location;
                  userDb.generation = generation;
                  userDb.gender = gender;
                  response.cookie('user', userDb);
                }
              }
              client.close();
              response.redirect('/'); // response.redirect('/logout'); の方がいい？
            });
          }else{
            collection.updateOne({name:{$eq:request.cookies['userName']}}, {$set:{name:name, location:location, generation:generation, gender:gender}},(error, results)=>{
              if(!error) {
                response.cookie('userName', name);
                if(userDb) {
                  userDb.name = name;
                  userDb.location = location;
                  userDb.generation = generation;
                  userDb.gender = gender;
                  response.cookie('user', userDb);
                }
              }
              client.close();
              response.redirect('/');
            });
          }
        }
      });
/*
                collection.updateOne({id:{$eq:parseInt(voteObj[i].id)}}, {$set:{voted: parseFloat(voteObj[i].vote)}},(error, results)=>{
                  client.close();
                });
*/
    });
  }
});

app.post('/vote', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let voteObj = JSON.parse(data);
      if(voteObj.length) {
        // console.log(voteObj);
        MongoClient.connect(mongouri, mongoOptions, (error, client) => {
          const db = client.db(process.env.DB);
          // コレクションの取得
          const collection = db.collection('answers');

          let objNum = voteObj.length;
          let count = 0;
          for(let i in voteObj) {
            if(parseFloat(voteObj[i].vote) || parseFloat(voteObj[i].vote) == 0) {
              if(parseInt(voteObj[i].rank)) {
                let oid = null;
                try{
                  oid = new ObjectID(voteObj[i].id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
                }catch(e){}

                collection.updateOne({$or:[{_id:{$eq:voteObj[i].id}}, {_id:{$eq:oid}}]}, {$set:{voted: parseFloat(voteObj[i].vote), rank:parseInt(voteObj[i].rank)}},(error, results)=>{
                  count++;
                  if(count == objNum) {
                    collection.find({
                      idx:{$ne:undefined}
                    }).sort({idx:1}).toArray((error, answers)=>{
                      if(!error) {
                        let ansNum = answers.length;
                        for(let ansKey in answers) {
                          let oid = null;
                          try{
                            oid = new ObjectID(answers[ansKey]._id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
                          }catch(e){}

                          collection.updateOne({$or:[{_id:{$eq:answers[ansKey]._id}}, {_id:{$eq:oid}}]}, {$set:{idx: parseInt(ansKey)}},(error, results)=>{
                            // console.log('ans:' + ansKey);
                            if(parseInt(ansKey) + 1 == ansNum) {
                              client.close();
                            }
                          });
                        }
                      }
                    });
                  }
                });
              }else{
                let oid = null;
                try{
                  oid = new ObjectID(voteObj[i].id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
                }catch(e){}

                collection.updateOne({$or:[{_id:{$eq:voteObj[i].id}}, {_id:{$eq:oid}}]}, {$set:{voted: parseFloat(voteObj[i].vote)}, $unset: {rank:1}},(error, results)=>{
                  count++;
                  if(count == objNum) {
                    collection.find({
                      idx:{$ne:undefined}
                    }).sort({idx:1}).toArray((error, answers)=>{
                      if(!error) {
                        let ansNum = answers.length;
                        for(let ansKey in answers) {
                          let oid = null;
                          try{
                            oid = new ObjectID(answers[ansKey]._id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
                          }catch(e){}

                          collection.updateOne({$or:[{_id:{$eq:answers[ansKey]._id}}, {_id:{$eq:oid}}]}, {$set:{idx: parseInt(ansKey)}},(error, results)=>{
                            if(parseInt(ansKey) + 1 == ansNum) {
                              client.close();
                            }
                          });
                        }
                      }
                    });
                  }
                });
              }
            }else{
              let oid = null;
              try{
                oid = new ObjectID(voteObj[i].id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
              }catch(e){}

              collection.updateOne({$or:[{_id:{$eq:voteObj[i].id}}, {_id:{$eq:oid}}]}, {$unset:{voted: 1, rank: 1, idx: 1}},(error, results)=>{
                count++;
                if(count == objNum) {
                  collection.find({
                    idx:{$ne:undefined}
                  }).sort({idx:1}).toArray((error, answers)=>{
                    if(!error) {
                      let ansNum = answers.length;
                      for(let ansKey in answers) {
                        let oid = null;
                        try{
                          oid = new ObjectID(answers[ansKey]._id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
                        }catch(e){}

                        answers[ansKey].idx = parseInt(ansKey);
                        collection.updateOne({$or:[{_id:{$eq:answers[ansKey]._id}}, {_id:{$eq:oid}}]}, {$set:{idx: parseInt(ansKey)}},(error, results)=>{
                            // console.log('ans:' + ansKey);
                          if(parseInt(ansKey) + 1 == ansNum) {
                            client.close();
                          }
                        });
                      }
                    }else{
                      client.close();
                    }
                  });
                }
              });
            }
          }
        });
      }
      response.sendStatus(200);
    });
  }else{
    response.sendStatus(400);
  }
});

// 回答の削除
app.post('/delete', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let delObj = JSON.parse(data);
      let ansId = delObj.id;

      // voted が undefined または null の回答のみ削除可能とする
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        if(err1) {
          response.status(500);
          response.send('Server Error.\n内部エラーです。申し訳ありません。');
        }else{
          const db = client.db(process.env.DB);
          const ansCol = db.collection('answers');
          let oid = null;
          try{
            oid = new ObjectID(ansId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
          }catch(e){
          }
          ansCol.findOne({$or:[{_id:{$eq:ansId}}, {_id:{$eq:oid}}]},(err2, answer)=>{
            /**/
            if(err2 || !answer) {
              response.status(500);
              response.send('Server Error.\n内部エラーです。申し訳ありません。');
            }else{
              if((answer.user_id != request.cookies.user._id) && !isAdmin) {
                client.close();
                response.status(400);
                response.send('Bad Request.\n自分の回答のみ削除可能です。');
              }else{
                if((answer.voted != undefined && answer.voted != null) || answer.fav) {
                  client.close();
                  response.status(400);
                  response.send('Error.\n削除できませんでした。');
                }else{
                  ansCol.remove({$or:[{_id:{$eq:ansId}}, {_id:{$eq:oid}}]},(err3, result1) => {
                    if(err3) {
                      response.status(500);
                      response.send('Server Error.\n内部エラーです。申し訳ありません。');
                    }else{
                      response.status(200);
                      response.send('OK');
                    }
                    client.close();
                  });
                }
              }
            }
            /**/
          });
        }
      });
    });
  }else{
    response.status(400);
    response.send('Bad Request');
  }
});

// お題の削除
app.post('/del_odai', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let delObj = JSON.parse(data);
      let odaiId = delObj.id;

      // voted が undefined または null の回答のみ削除可能とする
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        if(err1) {
          response.status(500);
          response.send('Server Error.\n内部エラーです。申し訳ありません。');
        }else{
          const db = client.db(process.env.DB);
          const odaiCol = db.collection('odais');

          let oid = null;
          try{
            oid = new ObjectID(odaiId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
          }catch(e){}

          odaiCol.findOne({$or:[{_id:{$eq:odaiId}}, {_id:{$eq:oid}}]},(err2, odai)=>{
            if(err2) {
              response.status(500);
              response.send('Server Error.\n内部エラーです。申し訳ありません。');
            }else{
              if((odai.user_id != request.cookies.user._id) && !isAdmin) {
                client.close();
                response.status(400);
                response.send('Bad Request.\n自分のお題のみ削除可能です。');
              }else{
                if(odai.date_release != undefined && odai.date_release != null) {
                  client.close();
                  response.status(400);
                  response.send('Error.\n公開済みのお題は削除できません。');
                }else if(odai.starred) {
                  client.close();
                  response.status(400);
                  response.send('Error.\n削除できませんでした。');
                }else{
                  odaiCol.remove({$or:[{_id:{$eq:odaiId}}, {_id:{$eq:oid}}]},(err3, result1) => {
                    if(err3) {
                      response.status(500);
                      response.send('Server Error.\n内部エラーです。申し訳ありません。');
                    }else{
                      response.status(200);
                      response.send('OK');
                    }
                    client.close();
                  });
                }
              }
            }
          });
        }
      });
    });
  }else{
    response.status(400);
    response.send('Bad Request');
  }
});

// 回答の編集
app.post('/edit_answer', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let editObj = JSON.parse(data);
      let ansId = editObj.id;
      let sentence = editObj.sentence;

      // voted が undefined または null の回答のみ削除可能とする
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        if(err1) {
          response.status(500);
          response.send('Server Error.\n内部エラーです。申し訳ありません。');
        }else{
          const db = client.db(process.env.DB);
          const ansCol = db.collection('answers');

          let oid = null;
          try{
            oid = new ObjectID(ansId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
          }catch(e){}

          ansCol.findOne({$or:[{_id:{$eq:ansId}}, {_id:{$eq:oid}}]},(err2, answer)=>{
            if(err2) {
              client.close();
              response.status(500);
              response.send('Server Error.\n内部エラーです。申し訳ありません。');
              return;
            }else{
              if(!answer) {
                client.close();
                response.status(500);
                response.send('Server Error.\n内部エラーです。申し訳ありません。');
                return;
              }
              if((answer.user_id != request.cookies.user._id) && !isAdmin) {
                client.close();
                response.status(400);
                response.send('Bad Request.\n自分の回答のみ編集可能です。');
              }else{
                if((answer.voted != undefined && answer.voted != null) || answer.fav) {
                  client.close();
                  response.status(400);
                  response.send('Error.\n編集できませんでした。');
                }else{
                  const odaiCol = db.collection('odais');

                  let oid = null;
                  try{
                    oid = new ObjectID(answer.odai_id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
                  }catch(e){}

                  odaiCol.findOne({$or:[{_id:{$eq:answer.odai_id}}, {_id:{$eq:oid}}]}, (err3, odai)=>{
                    if(err3) {
                      client.close();
                      response.status(500);
                      response.send('Server Error.\n内部エラーです。申し訳ありません。');
                      return;
                    }else if(!odai) {
                      client.close();
                      response.status(500);
                      response.send('Server Error.\n内部エラーです。申し訳ありません。');
                      return;
                    }else{
                      let date_close = odai.date_close;
                      let date_release = odai.date_release;

                      const confCol = db.collection('config');
                      confCol.findOne({allow_after_closed:{$ne:null}}, (err4, conf)=>{
                        let allow_after_closed = false;
                        if(conf && conf.allow_after_closed) {
                          allow_after_closed = conf.allow_after_closed;
                        }
                        let available = (date_release < Date.now()); // 募集中かどうか
                        if(odai.date_close) {
                          available = (available && Date.now() < date_close);
                        }

                        if(available || allow_after_closed || isAdmin) {

                          let oid = null;
                          try{
                            oid = new ObjectID(ansId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
                          }catch(e){}

                          ansCol.updateOne({$or:[{_id:{$eq:ansId}}, {_id:{$eq:oid}}]}, {$set:{sentence: sentence}},(err4, result1)=>{
                            if(err4) {
                              response.status(500);
                              response.send('Server Error.\n内部エラーです。申し訳ありません。');
                            }else{
                              response.status(200);
                              response.send('OK');
                            }
                            client.close();
                          });
                        }else{
                          client.close();
                          response.status(400);
                          response.send('Bad Request\n編集できるのは募集中の回答だけです。');
                        }
                      });
                    }
                  });
                }
              };
            }
          });
        }
      });
    });
  }else{
    response.status(400);
    response.send('Bad Request');
  }
});

// お題の編集
app.post('/edit_odai', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let editObj = JSON.parse(data);
      let odaiId = editObj.id;
      let sentence = editObj.sentence;

      if(sentence.split('\n').length > lineLimit) {
        response.status(400);
        response.send('お題は' + lineLimit + '行までにしてください');
        return;
      }

      // voted が undefined または null の回答のみ削除可能とする
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        if(err1) {
          response.status(500);
          response.send('Server Error.\n内部エラーです。申し訳ありません。a');
        }else{
          const db = client.db(process.env.DB);
          const odaiCol = db.collection('odais');
          let oid = null;
          try{
            oid = new ObjectID(odaiId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
          }catch(e){}

          odaiCol.findOne({$or:[{_id:{$eq:odaiId}}, {_id:{$eq:oid}}]},(err2, odai)=>{
            if(err2) {
              client.close();
              response.status(500);
              response.send('Server Error.\n内部エラーです。申し訳ありません。b');
              return;
            }else{
              if(!odai) {
                client.close();
                response.status(500);
                response.send('Server Error.\n内部エラーです。申し訳ありません。c\n' + odaiId);
                return;
              }
              if((odai.user_id != request.cookies.user._id) && !isAdmin) {
                console.log(odai.user_id, request.cookies.user._id);
                client.close();
                response.status(400);
                response.send('Bad Request.\n自分のお題のみ編集可能です。');
              }else{
                if(odai.date_release != undefined && odai.date_release != null) {
                  client.close();
                  response.status(400);
                  response.send('Error.\n公開済みのお題は編集できません。');
                }else if(odai.starred) {
                  client.close();
                  response.status(400);
                  response.send('Error.\n編集に失敗しました。');
                }else{
                  odaiCol.updateOne({$or:[{_id:{$eq:odaiId}}, {_id:{$eq:oid}}]}, {$set:{sentence: sentence}},(err3, result1)=>{
                    if(err3) {
                      response.status(500);
                      response.send('Server Error.\n内部エラーです。申し訳ありません。d');
                    }else{
                      response.status(200);
                      response.send('OK');
                    }
                    client.close();
                  });
                }
              };
            }
          });
        }
      });
    });
  }else{
    response.status(400);
    response.send('Bad Request');
  }
});

// 締め切り済みのお題でも回答を受け付けるか
app.get('/allowafterclosed', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  if(request.cookies.pw){
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      if(!error) {
        const db = client.db(process.env.DB);
        const collection = db.collection('config');
        // コレクション中で条件に合致するドキュメントを取得
        collection.findOne({}, (error, conf)=>{
          if(conf) {
            response.send(conf.allow_after_closed);
          }else{
            response.status(404);
            response.send('Not Found.\n設定情報が見つかりません。');
          }
          client.close();
        });
      }else{
        response.status(500);
        response.send('Server Error.\n内部エラーです。申し訳ありません。');
        client.close();
      }
    });
  } else {
    response.sendStatus(400);
  }
});

app.get('/overtwo', function(request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  if(request.cookies.pw){
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);
      const ansCol = db.collection('answers');
      ansCol.find({
        $and:[
          {voted:{$ne:undefined}},
          {voted:{$ne:0}}
        ]
      }).sort({'odai_id':1}).toArray((err, answers) => {
        if(err) {
          response.status(500);
        }
        let count = 0;
        let lastOdai = -1;
        for(let i in answers) {
          if(lastOdai != answers[i].odai_id) {
            count++;
            lastOdai = answers[i].odai_id;
          }
        }
        if(count > 1) {
          response.status(200);
          response.send(true);
        }else{
          response.status(200);
          response.send(false);
        }
        client.close();
      });
    });
  }
});

// グラフ用データ
app.get('/getgraphdata', function(request, response){
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw){
    let page = 0;
    let limit = 10;
    if(request.query.page) page = parseInt(request.query.page);
    if(request.query.limit) limit = parseInt(request.query.limit);

    let userId = request.cookies.user._id;
    if(request.query.userId && isAdmin) { // 管理者のときだけクエリでユーザIDを指定可能
      userId = request.query.userId;
    }
    if(!userId) {
      response.send([]);
      return;
    }
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);
      const odaiCol = db.collection('odais');
      const ansCol = db.collection('answers');
      let retObj = [];

      if(true) {
      // if(!isAdmin) { // 管理者は未発表でも参照可能にする？
        odaiCol.find({date_close:{$lt:Date.now()}}).toArray((err1, odais)=>{
          if(!odais.length) {
            response.send([]);
            client.close();
            return;
          }
          let odaiNum = odais.length;
          let count = 0;
          for(let i = 0; i < odais.length; i++){
            ansCol.find({
              odai_id:{$eq:odais[i]._id + ''}
            }).sort({voted:-1}).toArray((error, ans_all)=>{
              let evaluated = false;
              for(let i in ans_all) {
                if(ans_all[i].voted != undefined && ans_all[i].voted > 0) {
                  evaluated = true;
                  break;
                }
              }
              if(evaluated) retObj.push({odai:odais[i].sentence, odai_id:odais[i]._id, date_release:odais[i].date_release});
              ansCol.find({
                $and:[
                  {user_id:{$eq:userId}},
                  {rank:{$ne:undefined}},
                  {odai_id:{$eq:odais[i]._id + ''}}
                ]
              }).sort({voted:-1}).toArray((err2, answers)=>{
                if(answers.length) {
                  let best = answers[0];
                  for(let j in retObj) {
                    if(retObj[j].odai_id == answers[0].odai_id) {
                      let best = {rank:answers[0].rank, sentence:answers[0].sentence}
                      retObj[j].best = best;
                    }
                  }
                }
                count++;
                if(count == odaiNum) {
                  retObj.sort(function(a,b){
                    if(a.date_release<b.date_release) return -1;
                    if(a.date_release > b.date_release) return 1;
                    return 0;
                  });
                  if(limit) {
                    let start = retObj.length - (page + 1) * limit;
                    let end = retObj.length - page * limit;
                    if(start < 0) start = 0;
                    if(end > retObj.length) end = retObj.length;

                    response.send(retObj.slice(start, end));
                  }else{
                    response.send(retObj);
                  }
                  client.close();
                }
              });
            });
          }
        });
      }else{
        // 管理者は未発表でも参照可能にする？
        odaiCol.find({date_release:{$ne:undefined}}).sort({'date_release':1}).toArray((err1, odais)=>{
          if(!odais.length) {
            response.send([]);
            client.close();
            return;
          }
          let odaiNum = odais.length;
          let count = 0;
          for(let i = 0; i < odais.length; i++){
            retObj.push({odai:odais[i].sentence, odai_id:odais[i].id});
            const ansCol = db.collection('answers');
            ansCol.find({
              $and:[
                {user_id:{$eq:parseInt(userId)}},
                {voted:{$ne:undefined}},
                {odai_id:{$eq:odais[i].id}}
              ]
            }).sort({voted:-1}).toArray((err2, answers)=>{
              if(answers.length) {
                let ans = answers[0];
                for(let j in retObj) {
                  if(retObj[j].odai_id == ans.odai_id) {
                    let best = {rank:ans.rank, sentence:ans.sentence}
                    if((!odais[i].date_close || Date.now() < odais[i].date_close) && ans.voted == 0) {
                      best.rank = 10; // 未確定の場合
                    }
                    retObj[j].best = best;
                  }
                }
              }
              count++;
              if(count == odaiNum) {
                if(limit) {
                  response.send(retObj.slice(page*limit, (page + 1)*limit));
                }else{
                  response.send(retObj);
                }
                client.close();
              }
            });
          }
        });
      }
    });
  }else{
    response.sendStatus(400);
  }
});

// 初期データ投入用
//app.get('/makedata', function(request, response){
//  let dayOffset = 6; // 6日
//  let millisecOffset = dayOffset * 24 * 60 * 60 * 1000; // ミリ秒
//  let now = (new Date(2018, 4, 31, 0, 0, 0)).getTime();
//  let startTime = now - millisecOffset;

  /*
  MongoClient.connect(mongouri, mongoOptions, (error, client) => {
    const db = client.db(process.env.DB);
    const col = db.collection('users');
    let insertUsers = [];
    for(let i = 2; i <= 20; i++) {
      insertUsers.push({id:i, name:'user' + i, date_regist:now + (24*60*60*500*i) ,pw:hashed('pw')});
    }
    col.insertMany(insertUsers, (error, result) => {
      response.send(200);
      client.close();
    });
  });
  */

  /*
  MongoClient.connect(mongouri, mongoOptions, (error, client) => {
    const db = client.db(process.env.DB);
    const col = db.collection('odais');
    let insertOdais = [];
    for(let i = 1; i <= 50; i++) {
      let obj = {id:i, sentence:'お題' + i + ' ' + (function(lb, ub, n) {
    var cs = Array(n), span = ub - lb + 1;
    for (var i = 0; i < n; i++) {
        cs[i] = lb + Math.floor(Math.random() * span);
    }
    return String.fromCharCode.apply(String, cs);
})(0x3041, 0x3093, Math.floor( Math.random()*(20 + 1 - 15))+15), user_id:Math.floor( Math.random()*(20))+1, date:startTime + (60*60*1000 * 1 * i)};
      if(i <= 5) {
        obj.date_release = startTime + (60*60*1000 * 3 * i);
        if(i <= 4) {
          obj.date_close = obj.date_release + (60*60*1000 * 12);
        }
      }
      insertOdais.push(obj);
    }
    col.insertMany(insertOdais, (error, result) => {
      response.send(200);
      client.close();
    });
  });
  */

  /*
  MongoClient.connect(mongouri, mongoOptions, (error, client) => {
    const db = client.db(process.env.DB);
    const col = db.collection('answers');
    let insertAnswers = [];
    for(let i = 0; i <= 200; i++) {
      insertAnswers.push({id:i, sentence:'回答' + (i+1) + '\n' + (function(lb, ub, n) {
    var cs = Array(n), span = ub - lb + 1;
    for (var i = 0; i < n; i++) {
        cs[i] = lb + Math.floor(Math.random() * span);
    }
    return String.fromCharCode.apply(String, cs);
})(0x3041, 0x3093, Math.floor( Math.random()*(30 + 1 - 3))+3), user_id:Math.floor( Math.random()*(20))+1, odai_id:Math.floor( Math.random()*(5))+1, date:startTime + Math.floor(Math.random() * (now - startTime))});
    }
    col.insertMany(insertAnswers, (error, result) => {
      response.send(200);
      client.close();
    });
  });
  */
//});

// お題にスターを設定／除去
app.post('/setstar', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let targetId = JSON.parse(data).targetId;
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        const db = client.db(process.env.DB);
        const collection = db.collection('odais');

        let oid = null;
        try{
          oid = new ObjectID(targetId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
        }catch(e){}

        collection.findOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, (err1, odai)=>{
          if(!odai) {
            response.status(404);
            response.send('Not Found.\n' + targetId);
            return;
          }
          collection.updateOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, {$set:{starred: !odai.starred}},(err2, results)=>{
            if(!err1 && !err2) {
              response.status(200);
              response.send(!odai.starred);
            }else{
              response.sendStatus(500);
            }
            client.close();
          });
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

// 回答をお気に入りに設定／除去
app.post('/setfav', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let targetId = JSON.parse(data).targetId;
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        const db = client.db(process.env.DB);
        const collection = db.collection('answers');

        let oid = null;
        try{
          oid = new ObjectID(targetId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
        }catch(e){}

        collection.findOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, (err1, ans)=>{
          if(!ans) {
            response.status(404);
            response.send('Not Found.\n' + targetId);
            client.close();
            return;
          }
          collection.updateOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, {$set:{fav: !ans.fav}},(err2, results)=>{
            if(!err1 && !err2) {
              response.status(200);
              response.send(!ans.fav);
            }else{
              response.sendStatus(500);
            }
            client.close();
          });
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

// ゴミ箱に入れる／復帰
app.post('/trash', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let targetId = JSON.parse(data).targetId;
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        const db = client.db(process.env.DB);
        const collection = db.collection('answers');

        let oid = null;
        try{
          oid = new ObjectID(targetId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
        }catch(e){}

        collection.findOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, (err1, answer)=>{
          if(!answer) {
            response.status(404);
            response.send('Not Found.\n' + targetId);
            client.close();
            return;
          }
          collection.updateOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, {$set:{trashed: !answer.trashed}},(err2, results)=>{
            if(!err1 && !err2) {
              response.status(200);
              response.send(!answer.trashed);
            }else{
              response.sendStatus(500);
            }
            client.close();
          });
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

// お題をゴミ箱に入れる／復帰
app.post('/trash_odai', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let targetId = JSON.parse(data).targetId;
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        const db = client.db(process.env.DB);
        const collection = db.collection('odais');

        let oid = null;
        try{
          oid = new ObjectID(targetId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
        }catch(e){}

        collection.findOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, (err1, odai)=>{
          if(!odai) {
            response.status(404);
            response.send('Not Found.\n' + targetId);
            client.close();
            return;
          }
          collection.updateOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, {$set:{trashed: !odai.trashed}},(err2, results)=>{
            if(!err1 && !err2) {
              response.status(200);
              response.send(!odai.trashed);
            }else{
              response.sendStatus(500);
            }
            client.close();
          });
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.get('/mask_answers', function(request, response) {
  MongoClient.connect(mongouri, mongoOptions, async (error, client) => {
    const db = client.db(process.env.DB);
    // コレクションの取得
    const ansCol = db.collection('answers');
    const userCol = db.collection('users');

    Promise.all([find(ansCol, {}), find(userCol, {})]).then(function(receivedList) {
      const tasks = [];
      const answers = receivedList[0];
      const users = receivedList[1];

      for(let i in answers) {
        for(let j in users) {
          if(answers[i].user_id == users[j]._id) {
            tasks.push(updateMany(ansCol, {_id:{$eq:answers[i]._id}}, {$set:{sentence: users[j].name + ' : ' + getOneTimePw(16)}}));
            break;
          }
        }
      }

      Promise.all(tasks).then(function (receivedList) {
        response.send('hello');
      }).catch(function(error){
        response.status(500);
        response.send(error);
      }).then(function(){
        // console.log(tasks[0].then, tasks[0].catch, tasks[0].finally);
        // console.log('finally is not defined.');
        client.close();
      });
    });
  });
});

app.post('/makepw', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(!isAdmin) {
    response.status(400);
    response.send('Bad Request.\n管理者のみに可能な操作です。');
    return;
  }
  if(request.cookies['pw']) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      console.log(data);
      let obj = JSON.parse(data);
      if(obj.id) {
        MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
          if(err1) {
            response.status(500);
            response.send('Server Error.\n内部エラーです。申し訳ありません。');
            return;
          }
          const db = client.db(process.env.DB);
          const collection = db.collection('users');
          let pw = getOneTimePw(8);
          let hashedpw = hashed(pw);

          let oid = null;
          try{
            oid = new ObjectID(obj.id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
          }catch(e){
          }

          collection.findOne({$or:[{_id:{$eq:obj.id}}, {_id:{$eq:oid}}]}, (err2, user)=>{
            if(user && user.is_admin) {
              response.status(400);
              response.send('Bad Request.\n管理者のパスワードは発行できません。');
              client.close();
            }else{
              collection.updateOne({$or:[{_id:{$eq:obj.id}}, {_id:{$eq:oid}}]}, {$set:{pw: hashedpw}},(err3, results)=>{
                if(err3) {
                  response.status(500);
                  response.send('Server Error.\n内部エラーです。申し訳ありません。');
                }else{
                  response.send({pw:pw});
                }
                client.close();
              });
            }
          });
        });
      }
    });
  }else{
    response.status(400);
    response.send('Bad Request.');
  }
});

app.post('/sendmail', function(request, response) {
//  if(request.cookies.pw) { // ログインしない状態でのアクセスを許す
  if(true) { // ログインしない状態でのアクセスを許す
    let data = '';
    let sizeLimit = 300 * 1.4;
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let mailObj = JSON.parse(data);

      if(!mailObj.text && !mailObj.attachs.length) {
        response.status(400);
        response.send('何か書けー');
        return;
      }

      for(let i in mailObj.attachs) {
        if(mailObj.attachs[i].data.length > sizeLimit * 1024) {
          response.status(400);
          response.send('ひぎぃ！');
          return;
        }
      }

      MongoClient.connect(mongouri, mongoOptions, (error, client) => {
        const db = client.db(process.env.DB2);
        const collection = db.collection('mails');
        collection.find().toArray((err1, mails)=>{
          if(!err1){
//            mailObj.id = mails.length;
            if(request.cookies && request.cookies.user) mailObj.from = parseInt(request.cookies.user.id);
            mailObj.date = Date.now();
            mailObj.is_new = true;
            collection.insertOne(mailObj, (err2, results)=>{
              if(!err2) {
                response.status(200);
                response.send('OK');
              }else{
                response.status(500);
                response.send('Server Error.\n内部エラーです。申し訳ありません。\nERR002\n' + err2);
              }
              client.close();
            });
          }else{
            response.status(500);
            response.send('Server Error.\n内部エラーです。申し訳ありません。\nERR001\n' + err1);
            client.close();
          }
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.get('/getmails', function(request, response) {
  let countNew = request.query.count_new;
  let includeData = request.query.include_data; // 添付ファイルを含むか（この機能いるか？）
  let getBytes = request.query.get_bytes; // 容量だけを返す
  let sent = request.query.sent;

  if(request.cookies.pw) {
    let condition = {};
    if(request.cookies && request.cookies.user) {
      condition = {to:{$eq:request.cookies.user.id}};
      if(sent) condition = {from:{$eq:request.cookies.user.id}};
    }

    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB2);
      const collection = db.collection('mails');
      collection.find(condition).sort({date:-1}).toArray((err1, mails)=>{
        if(getBytes) {
          response.status(200);
          response.send(encodeURIComponent(JSON.stringify(mails)).replace(/%../g, 'x').length + '');
        }else{
          let newCount = 0;
          
          if(mails.length == 0) {
            if(countNew) {
              let obj = {count:0};
              response.send(obj);
            }else{
              response.send([]);
            }
            client.close();
            return;
          }
          for(let i in mails) {
            for(let j in mails[i].attachs) {
              if(!includeData) delete mails[i].attachs[j].data; // 添付ファイル本体は除去
            }
            if(mails[i].is_new) newCount++; // 未読の数
            mails[i].text = headText(mails[i].text, 32);
          }
          MongoClient.connect(mongouri, mongoOptions, (err2, clientUser) => {
            const dbUser = clientUser.db(process.env.DB);
            const colUser = dbUser.collection('users');
            colUser.find({}).toArray((err3, users)=>{
              for(let i in mails) {
                for(let j in users) {
                  if(mails[i].from == users[j].id) {
                    if(!mails[i].disp) mails[i].user_name = users[j].name;
                  }
                }
                if(!mails[i].user_name) mails[i].user_name = mails[i].disp;

                if(i == mails.length - 1) {
                  if(!error && !err1 && !err2 && !err3){
                    if(countNew) {
                      let obj = {count:newCount};
                      if(newCount) obj.latest_id = mails[0]._id;
                      response.send(obj);
                    }else{
                      response.send(mails);
                    }
                  }else{
                    response.status(500);
                    response.send('Server Error.\n内部エラーです。申し訳ありません。');
                  }
                  clientUser.close();
                  client.close();
                }
              }
            });
          });
        }
      });
    });
  }else{
    // response.sendStatus(400);
    response.sendStatus(200); // ログインしてなくても OK を返す
  }
});

app.get('/getmail', function(request, response) {
  let id = request.query.id; // これを指定すると ID が合致する１件になるはず
  let dl = request.query.dl; // ダウンロード

  if(request.cookies.pw) {
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB2);
      const collection = db.collection('mails');
      let oid = null;
      try{
        oid = new ObjectID(id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
      }catch(e){
        response.status(400);
        response.send('不正なIDです。');
        client.close();
        return;
      }
      collection.findOne({_id:{$eq:oid}}, (err1, mail)=>{
        if(!err1){
          if(mail) {
            if(mail.to != request.cookies.user.id && mail.from != request.cookies.user.id) {
              response.status(400);
              response.send('Bad Request.\nあなたと無関係なメールです。');
              client.close();
              return;
            }
            for(let i in mail.attachs){
              if(!dl) delete mail.attachs[i].data;
            }
            MongoClient.connect(mongouri, mongoOptions, (error, clientUser) => {
              const dbUser = clientUser.db(process.env.DB);
              const colUser = dbUser.collection('users');
              colUser.findOne({id:{$eq:mail.from}}, (err2, user)=>{
                if(!user) {
                  // ログインせず出したメール
                  user = {id: -1, name: mail.disp};
                }
                mail.user = user;
                if(dl) {
                  let nowDate = new Date();
                  nowDate.setHours(nowDate.getHours() + 9); // 9時間ずれてる
                  response.set('Content-Type', 'application/octet-stream');
                  response.attachment(user.name + '_' + getNowYMD(nowDate)+ '_' + headText(mail.text, 16) + '.json');
                  response.status(200);
                  response.send(mail);
                }else{
                  response.send(mail);
                }
                clientUser.close();
                client.close();
              });
            });
          }else{
            response.status(404);
            response.send('Not Found.\nメールが見つかりません。');
      client.close();
          }
        }else{
          response.status(500);
          response.send('Server Error.\n内部エラーです。申し訳ありません。');
      client.close();
        }
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.post('/checked', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    let sizeLimit = 300 * 1.4;
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let mailObj = JSON.parse(data); // {id:'5b1f853d86bf73004b5a301b'} とか
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        const db = client.db(process.env.DB2);
        const collection = db.collection('mails');
        let oid = new ObjectID(mailObj.id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
        collection.updateOne({_id:{$eq:oid}}, {$unset:{is_new: 1}},(err2, results)=>{
          if(!err1 && !err2) {
            response.sendStatus(200);
          }else{
            response.sendStatus(500);
          }
          client.close();
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.post('/togglestar', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    let data = '';
    let sizeLimit = 300 * 1.4;
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let mailObj = JSON.parse(data); // {id:'5b1f853d86bf73004b5a301b'} とか
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        const db = client.db(process.env.DB2);
        const collection = db.collection('mails');
        let oid = new ObjectID(mailObj.id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
        collection.findOne({_id:{$eq:oid}}, (err1, mail)=>{
          collection.updateOne({_id:{$eq:oid}}, {$set:{starred: !mail.starred}},(err2, results)=>{
            if(!err1 && !err2) {
              response.status(200);
              response.send(!mail.starred);
            }else{
              response.sendStatus(500);
            }
            client.close();
          });
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.post('/setprivate', function(request, response) {
  if(request.cookies.pw) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let targetId = JSON.parse(data).targetId;
      let oid = null;
      try{
        oid = new ObjectID(targetId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
      }catch(e){
      }
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        const db = client.db(process.env.DB);
        const collection = db.collection('answers');
        collection.findOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, (err1, ans)=>{
          if(!ans) {
            response.status(404);
            response.send('Not Found.\n' + targetId);
            client.close();
            return;
          }else if(ans.user_id != request.cookies.user._id) {
            response.status(400);
            response.send('Bad Request.\nあなたの回答ではありません。');
            client.close();
            return;
          }

          const colOdai = db.collection('odais');
          let oid = null;
          try{
            oid = new ObjectID(ans.odai_id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
          }catch(e){
          }
          colOdai.findOne({$or:[{_id:{$eq:ans.odai_id}}, {_id:{$eq:oid}}]}, (err_odai, odai)=>{
            let available = true; // 募集中かどうか
            available = (odai.date_release < Date.now());
            if(odai.date_close) {
              available = (available && Date.now() < odai.date_close);

              const colConf = db.collection('config');
              colConf.findOne({allow_after_closed:{$ne:null}}, (err_conf, conf)=>{
                let allow_after_closed = false; // 締め切り後の投稿を許可するか
                if(!err_conf && conf) {
                  allow_after_closed = conf.allow_after_closed;
                  if(available) {
                    // if((!ans.private && ans.voted != undefined) || (!ans.private && ans.fav != undefined)) {
                    if(ans.voted != undefined || ans.fav) {
                      response.status(400);
                      response.send('申し訳ありません、非公開にできませんでした。1');
                      client.close();
                      return;
                    }

                    let oid = null;
                    try{
                      oid = new ObjectID(targetId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
                    }catch(e){
                    }

                    collection.updateOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, {$set:{private: !ans.private}},(err2, results)=>{
                      if(!err1 && !err2) {
                        response.status(200);
                        response.send(!ans.private);
                      }else{
                        response.sendStatus(500);
                      }
                      client.close();
                    });
                  }else{
                    response.status(400);
                    response.send('公開状態を変更できるのは募集中のお題のみです。');
                    client.close();
                    return;
                  }
                }else{
                  response.sendStatus(200);
                  client.close();
                  return;
                }
              });
            }else{
              // if((!ans.private && ans.voted != undefined) || (!ans.private && ans.fav != undefined)) {
              if(ans.voted != undefined || ans.fav) {
                response.status(400);
                response.send('申し訳ありません、非公開にできませんでした。2\n' + targetId);
                client.close();
                return;
              }

              let oid = null;
              try{
                oid = new ObjectID(targetId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
              }catch(e){
              }

              collection.updateOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, {$set:{private: !ans.private}},(err2, results)=>{
                if(!err1 && !err2) {
                  response.status(200);
                  response.send(!ans.private);
                }else{
                  response.sendStatus(500);
                }
                client.close();
              });
            }
          });


        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.post('/setnote', function(request, response) {
  if(request.cookies.pw) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let targetId = JSON.parse(data).targetId;
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        const db = client.db(process.env.DB);
        const collection = db.collection('answers');

        let oid = null;
        try{
          oid = new ObjectID(targetId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
        }catch(e){
        }
        collection.findOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, (err1, ans)=>{
          if(!ans) {
            response.status(404);
            response.send('Not Found.\n' + targetId);
            client.close();
            return;
          }else if(ans.user_id != request.cookies.user._id) {
            response.status(400);
            response.send('Bad Request.\nあなたの回答ではありません。');
            client.close();
            return;
          }

          collection.updateOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, {$set:{note: !ans.note}},(err2, results)=>{
            if(!err1 && !err2) {
              response.status(200);
              response.send(!ans.note);
            }else{
              response.sendStatus(500);
            }
            client.close();
          });
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.get('/url', function(request, response){
  response.redirect('https://www.google.com' + request.url);
});

app.get('/search', function(request, response){
  const u = url.parse(request.url, true); // 第2引数はクエリ文字列をパースするかどうか

  let queries = [];
  for(let i in u.query) {
    queries.push(i + '=' + encodeURIComponent(u.query[i]));
  }
  const headers = {
    // Header が必要な場合は適切に設定すること
    'Accept':'text/html',
    'User-Agent':'myApp',
    'accept-language': 'ja,en-US;q=0.8,en;q=0.6',
    'User-Agent':'Mozilla/5.0+(Linux;+U;+Android+4.1.1;+ja-jp;+HTL21+Build/JRO03C)+AppleWebKit/534.30+(KHTML,+like+Gecko)+Version/4.0+Mobile+Safari/534.30'
  }

  const targetUrl = 'https://www.google.com/search?' + queries.join('&');

  //オプションを定義
  const options = {
    url: targetUrl,
    method: 'GET',
    encoding: null, // null を指定しないとレスポンスを toString したものが Body になる
    headers: headers,
    json: false
  }

  //リクエスト送信
  httpRequest(options, function (err, response1, data) {
    if (err) {
      response.writeHead(400, {'Content-Type': 'text/html'});
      response.write(err.message);
      response.end();
    } else {
      if (response1.statusCode === 200) {
        // 文字コードを判定
        var encoding = undefined;
        if (response1.headers['content-type'] !== undefined) {
          encoding = mimelib.parseHeaderLine(response1.headers['content-type']).charset;
        }
        if (encoding === undefined) {
          encoding = jschardet.detect(data).encoding;
        }

        if (encoding !== undefined && iconv.encodingExists(encoding)) {
          // 適切な文字コードに変換して出力
          response.writeHead(200, {'Content-Type': 'text/html'});
          var responseText = iconv.decode(data, encoding);
          // responseText = responseText.replace(/<script[^>]+?\/>|<script(.|\s)*?\/script>/gi, ''); // script タグ除去
          responseText = responseText.replace(/<footer>/gi, ''); // script タグ除去
          responseText = responseText.replace(/<img[^>]+?>/gi, ''); // footer タグ除去
          responseText = responseText.replace(/<div id=\"msc\"/gi, '<div id="msc" style="display:none;"');
          responseText = responseText.replace(/\"extrares\"/gi, '"extrares" style="display:none;"');
          responseText = responseText.replace(/\"sfooter\"/gi, '"sfooter" style="display:none;"');
          responseText = responseText.replace(/<div class=\"NFQFxe\"/gi, '<div style="display:none;" class="NFQFxe');
          // responseText = responseText.replace(/\/search/gi, '/api/search');
          responseText = responseText.replace(/class=\"XlZAXb\"/gi, 'class="XlZAXb" style="display:none;"');
          responseText = responseText.replace(/class=\"cOl4Id\"/gi, 'class="cOl4Id" style="display:none;"');
          responseText = responseText.replace(/class=\"KP7LCb\"/gi, 'class="KP7LCb" style="display:none;"');
          responseText = responseText.replace(/id=\"qslc\"/gi, 'id="qslc" style="height:10px;"');
          responseText = responseText.replace(/\"aZ2wEe\"/gi, '"aZ2wEe" style="display:none;"');
          // responseText = responseText.replace(/\/images\/nav_logo289_hr.png/gi, 'https://www.google.com/images/nav_logo289_hr.png');
          responseText = responseText.replace(/\/images\/nav_logo289_hr.png/gi, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAAGJCAYAAAANGzhnAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAAOwgAADsIBFShKgAAAABh0RVh0U29mdHdhcmUAcGFpbnQubmV0IDQuMS42/U4J6AAADZJJREFUeF7t2gtwXNV9x/E1kmwCBAgkgdRDCiSE1hko0e4Kj2t7tbuSIyjlIaES8mjS9DFMM3SGkrZJabwZ7V2JV0iTMkmgTF4ESzaTNAVCsCQngabJkEJCizOEkGIMNtYLPfbuai3J3u3vf+6RatkG25hM0ub7mTlz9569d73r+9v/OedqYwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwSnK1Y/wjAPh/p7aks7NW53deVluueuK63OQpOSoiXkvZnvC8dBD+KJ0v9We7p97huxex0OmYuzKF8Ll0ofTN1KdrJ/ungKNjoUsXwhmFK0zlSqf77kVS+eJqBXB3plCqZYLSiIXWPwUcnWzP5NkKV9kFq3vqVN+9oK1QfFMmCJ/y4Rv322cyheIKfwjw6mV7KmerApbTQWnI5ni+20nlJk7WkPsDF7pC+GwqKF2g/e9GIQx3ZfNhS6xWW+IPBw5fKrftWIXq/Zr7fVTbORuCM0H5mkyhfGXnplpdS278rc1B8QkLmwI6peea3Hm3Ft+oCvi9KJSl2XRQvH21qqR70VdQbT3/+OFssjCcafrbsbamE303flO5oTUK0eIWhNMK40c0LE/6/WomKN6wtkuLla7wndY0/K5RCJ+cP0fVc0qV8VO/f+P4W/3LH2Br54qlCuDESDY5u3XFiqW++5fq3T2VMxequiq1PldaX6ZPtl3782WuD786qVztZAXnOwrQD/83SFoNF8Ifqu31+zt10apq2t+vuWCWtuo1fFBLI+s+VT1lqKVp5XAm+bORTOInw9nEYyPZxBNqPx1OJ55W3x71zSmIT6nvP4czif/QsT9S3+NqP1X7Z//2Fql9N1Y/N1DXPDu49Ia5LQ3/NDfY0DXT33B1OHj8af6QA+j93Kb3OJsJpv7Qd8X0ue5zn6tQbPdd+FXTBfl7FyC1bHe50Nm5qU6PH1bI7lh10+jrFbCvab9PF+/Hdoy2L2q7QeG8V4/fa5VU289rKP8He70xBVDhGlKwtqva/WIkk/xvPX5efbsUvKprmeRotJ94QW2bgvmswrhTx9/t3tQ+KoN16bmB+qdmBxuqCl7Nmh7vnR1oqKoV9ww2/GmtFjvg3mS6e+pSe78K4Z2+K2ZVXJ+rov6tnbnay1fhWmzJyo1XnpLs7cg2buj4q0Rvx2fjGzq+attEb/sHmu5uYwrxWrC5nuZwg+5CWbiCcHtbbuxE64/fUWtw7S8eU6s1ZLrLeX/M91Q9612/P2bfG9m5WOwYm+MNp1acsG97ft3KUxS8SbXdE6nfO3n/54dTqROqbW2LhkZVuQ9EYat/YWZLw9Xa9ip0c5XNdetmN9evdcEcaNhrx/lTFjTpc+jLU1QAt626qfr6TDC2XPt/rPf/kv8cj2gqcXOmMHO+3Yy30DX2tr830ddxT7yv4+lEX/tePa7Fe9v3aLtb22nbWp9CuL3xa5dxK+porcm/dIYuxkQUQDe0VjPdpc/Z3391sXSBSv+uC/hv2lp7wY7ThbNbMQ+7CxiUvq9zNISXL/cvGXtpXeIMVbLaq2w3+ZeJVbcsPVfhmpodrB+rbFn2NlW5JXMDDY+or6zAuYu/e2DpOxTQSR2zXcP0Ce5Ez6q3Psv3o2G4tFXvc8491ufVZxvW+9f0olRWC7PB1B/YOQrW36jNKoBDCuD98d6Ov4v3tV+c3NDxzgs3vOc02yqAd1kIFdbHU7lUvfvH8GpoUh6UbrBQuRaEFsRf+At2UTofFq1fF2tM+yPq1+LEjitNq28katHNaR17tX/RhQBqqH18LNt0nTXt/7WG2o1WAceyyds15K5X67Gt+j8+mkncaeeMZpOf9C8Tmxlo+LwNtzMaYm3fhtm5wfpnLHDTA8cuLHZm++vvjYbmuots3+5latGU0/t1K/joM6jqBaXPNhfCbHSzPbp1lO2ptGj6oPls6Unbd8NuX/vaprvf97JD7Ns/07ZMwXxSQZ2Jb7p8te/GkXLDUiF8zgLlLlIh3NGcD6+y/VQ+bNaq1g1VOuZ8tdM0VH/Z9nURv2L7rgWhKqAdU77Sv+y+AdxgQ+uObPLU0XXx31Hfc5rnFRW6i3ZeEj9Ozz+qeeCHbXU8lom32jmaL95sr1F9MHaiQjWiIfZnta0xN1erbYrVKXxTqoBDqnbHWp/RHPBDLoADdbfYfrZr6hL/eV5U+6Z7f0H4LXfwQei5XWqzNvXwXYfU2Nfe5argho4/9104UtFtmLBq9/Gibbg92109VfOi9W5u6AO4Jii9xY7PBOUvRmELu90LiBuG9wvgtlTqWK14/0SBukRh+/b8IkSVbnook7zC7geq7+supJlkn839hrKJs3fZOZmmNfYaqn7vUth2K2z/akOv9ZUeOO509VU1DD9q+/PmttRlrF/zw3trsdgSm5OqAv5Z6y3hmy1U0VAbPmdfOH/KApvL6gun6q4vXW7bQqgPJbGh48NuLrixY2HKgCPUan/VCErjqe5Smy7QnAWw5cbxk+b/sqGL4uaGzUFxczoo3x9dSAtb6b/0+Nsadh/U+S6kWVVO96L7UBiOGW1JJhTCn0TVLT4wllm5fCSdvM+FL5v4glVCVcF7VRkHd6bib/SnxjSnW6NQ7dFc7zbfFasMLGuLhtqGz/kuR5XP9c/2NzwwH9Z5tjhSFbxPn69i9y+jwJWXa/80+xOkfdn0WF++0nf8KYdFK+JrXAD7OgLfhSOVzk//tv7j/zHVXXm7hqCK2gstN9ZO8k9bdYvmfIfR0t2lhVWohWq8JX7S/Hak5cJzFLhH7faLtuO2VcV7aCgbv0z7lyiAX7I+BfLh0VWrXJWa3VK/1gI427/0BveiopB1qSJWbTXsuxxVvmtdAAfqv+S7FlEAr7P32Nw99UG3MAnCZ/TZxvUFi+a4hfD5dH7ybf7ww6IV8Ua3St7Y8X7fhSNlQ44Lof7zNdyWdSF27vszqzX5ibPW5KfPaMmN/lY2KN26b+Ay+eL61M2l0zNBdXkqN3Fm6/W7jvenxUaaE1epok0pXBO2dfM+Db9W9RZaJrFn0b6aC2gm8WWbE1Y1BCtUu2f66+/wL6sAulsu09XNy87yXe4GtYI6aAHcM1h/je9eJPrLjSq8KqHbLxQ/oxB+S+2r6rs2lRtetHo+FLs3qFXynBYiY413X+GmJzgKrgLaEHWQHyOYVE/lTDdPsmoRhD9Q26NWTHeVLj7YDxFsmNXc7scK1IOqdDa8PmxVbiQbv12Pd1vYtOr9yEhL/OKhdOLSydXnvcHuEeqYf1G7taY5ZPWR2JsUqkmF7unaY7EGVcRVNs/TguMh/884c/11WYWyoucmqwOxA37JY1b3TL5B73+bvmQ/j8Jm9/wOfN+HkvzG5adq8XG9Kt+sVT+tlq/3T+FoLPweUCHb/+dYa7sm3qWwPe/D9+yaYOQtWrT0RpXQ3VfrcfPG/Wzq7KyrqQ1lmy5TEK0S3laLxxu0tSF472PucfxKDbv2Z7n7bP5Xy8WOsUWEfwkbWr/oh9bHZ6IFSbWiwNlztiLe3V93qYI3pmbHXOdOOojoZru7p1mxX/747kNShWtuvOeK9zX2XvGJeF/7g3bbRXO+qobfOT1ebzeu/aE4Gumu3edGYdKCJFd0C4H0jRq28uEdCljVhS0IJ7Ld5aQ913pL9XiF8f4ohDaHKg2rfWxt19Q59rwZTSfO1XD6FVXCvQrYuM33rF/7owrhjAVwZ9zdiumNhuDEjqFs8hMvtl2w8Kua8uDrlqsCPmEh1Kp4jxYbgd2S0QJlvYXSAqnnZrQqvtWGYn/aQWlVfEv0XsM/8l2HlOxt/5BfaEStt32H2hcuuKd94XPiNbC2q/i7CpCG1dKk/axKYds8Hy5bISqYzzR3ly/0hzvx3M7j9Fy3ghj9StoublAaa82Fbx5qaVypylZR0Gye1z/x7gvP9KfFRjLJEfVXNMy6wFjV07Efd1VS1dBC6A70okq39BwFzH0xbH9uoP7OaNitf0BBPKwbwdm8rfTdF+nrvuuQ7KZ0orfjowrdVY29l9sihYr3yxAF0H6SX5qwANm+Qld086Z88WMHG2Ln2W8EFd5v6MJOZ4PyX1qfDaOqfhdZs4C5A8WGZFW6bWpD8wGct6u16azhbOMH7Rjf9bLsJnT1odgBc9VXks1Nnp3Ohzv0hbnLbsX4bvw6sIl5Kl9pWVsIW+dvxtovn63KuQMOQ7YrPO/X+8K+uoUHAAAAAAAAAAD4PycW+x/EkAczwB0DngAAAABJRU5ErkJggg==');
          // responseText = responseText.replace(/<style[^>]+?\/>|<style(.|\s)*?\/style>/gi, ''); // style タグ除去
          response.write(responseText);
          response.end();
// console.log(responseText);
        } else {
          // そのまま出力（Glitchではこちらでも文字化けしない）
          response.writeHead(200, {'Content-Type': response1.headers['content-type']});
          response.write(data);
          response.end();
        }
      } else {
        response.writeHead(response1.statusCode, {'Content-Type': 'text/html'});
        response.write('can\'t process.');
        response.end();
      }
    }
    // console.log("done");
  });
  // console.log("send");
})

// 動画URLを設定
app.post('/setvideourl', function(request, response) {
  if(request.cookies.pw) {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let targetId = JSON.parse(data).targetId;
      let videoUrl = JSON.parse(data).videoUrl;

      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        if(err1) {
          response.sendStatus(500);
          client.close();
          return;
        }
        const db = client.db(process.env.DB);
        const collection = db.collection('odais');

        let oid = null;
        try{
          oid = new ObjectID(targetId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
        }catch(e){
        }
        collection.updateOne({$or:[{_id:{$eq:targetId}}, {_id:{$eq:oid}}]}, {$set:{videoUrl: videoUrl, videoEditedBy:request.cookies['user']._id, videoEditedAt: Date.now()}},(err2, results)=>{
          if(err2) {
            response.sendStatus(500);
          }else{
            response.sendStatus(200);
          }
          client.close();
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

app.post('/delmail', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw) {
    let data = '';
    let sizeLimit = 300 * 1.4;
    request.setEncoding('utf8');
    request.on('data', function(chunk) {
      data += chunk;
    });
    request.on('end', function() {
      let mailObj = JSON.parse(data); // {id:'5b1f853d86bf73004b5a301b'} とか
      if(mailObj.user.id != request.cookies.user.id && !isAdmin) {
        response.status(400);
        response.send('あなたはこのおたよりを消せません');
      }
      MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
        const db = client.db(process.env.DB2);
        const collection = db.collection('mails');
        let oid = new ObjectID(mailObj.id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
        collection.remove({_id:{$eq:oid}},(err2, results) => {
          if(!err1 && !err2) {
            response.sendStatus(200);
          }else{
            response.sendStatus(500);
          }
          client.close();
        });
      });
    });
  }else{
    response.sendStatus(400);
  }
});

/*
app.get('/testchecked', function(request, response) {
  let id = request.query.id;
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
      const db = client.db(process.env.DB2);
      const collection = db.collection('mails');
      let oid = new ObjectID(id); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
      collection.updateOne({_id:{$eq:oid}}, {$unset:{is_new: 1}},(err2, results)=>{
        if(!err1 && !err2) {
          response.sendStatus(200);
        }else{
          response.sendStatus(500);
        }
        client.close();
      });
    });
  }else{
    response.sendStatus(400);
  }
});
*/

function numToStr(num) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let retStr = new String('');
  while (num > 0){
    retStr = chars.charAt(num % 62) + retStr;
    num = Math.floor(num / 62);
  }
  return retStr;
}

function strToNum(str) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let retNum = 0;

  for (let i = 0; i <= str.length; i++) {
    for (let j = 0; j < 62; j++) {
      if(chars.charAt(j) == str.charAt(i)) {
        retNum += j * Math.pow(62, str.length - i - 1);
      }
    }
  }
  return retNum;
}

// 先頭から指定バイト数の文字列を返す
function headText(text, bytes) {
  let text_array = text.split('');
  let count = 0;
  let str = '';
  for (let i = 0; i < text_array.length; i++) {
    let n = escape(text_array[i]);
    if (n.length < 4) count++;
    else count += 2;
    if (count > bytes) {
      return str + '…';
    }
    str += text.charAt(i);
  }
  return text;
}

app.get('/getattach', function(request, response) {
  let mailId = request.query.mailId;
  let idx = parseInt(request.query.idx);

  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw) {
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB2);
      const collection = db.collection('mails');
      collection.find({}).toArray((err1, mails)=>{
        if(!err1){
          let mail = null;
          for(let i in mails) {
            if(mails[i]._id == mailId) {
              mail = mails[i];
            }
          }
          
          if(isAdmin || request.cookies.user.id == mail.from) {
            if(mail && mail.attachs && mail.attachs.length) {
              response.send(mail.attachs[idx].data);
            }else{
              response.status(404);
              response.send('Not Found.\n添付ファイルが見つかりません。');
            }
          }else{
            response.status(400);
            response.send('Bad Request.\n一般ユーザは自分の添付ファイルしか閲覧できません。');
          }
        }else{
          response.status(500);
          response.send('Server Error.\n内部エラーです。申し訳ありません。');
        }
      });
      client.close();
    });
  }else{
    response.sendStatus(400);
  }
});

app.get('/badend', function(request, response) {
  MongoClient.connect(mongouri, mongoOptions, (error, client) => {
    const db = client.db(process.env.DB);
    const col = db.collection('badend');
    col.findOne({}, (error, doc)=>{
      if(doc) {
        response.send(doc.badend);
      }else{
        response.send([]);
      }
      client.close();
    });
  });
});

app.post('/badend', function(request, response) {
  let data = '';
  request.setEncoding('utf8');
  request.on('data', function(chunk) {
    data += chunk;
  });
  request.on('end', function() {
    MongoClient.connect(mongouri, mongoOptions, (error, client) => {
      const db = client.db(process.env.DB);
      const col = db.collection('badend');
      col.remove({},(err1, result1) => {
        let obj = {badend: JSON.parse(data)};
        if(!err1) {
          col.insertOne(obj, (err2, result2) => {
            if(err2) {
              response.sendStatus(400);
            }else{
              response.sendStatus(200);
            }
            client.close();
          });
        }else{
          response.sendStatus(200);
          client.close();
        }
      });
    });
  });
});

/*
app.get('/getmails', function(request, response) {
  let isAdmin;
  if(request.cookies.user) {
    if(request.cookies.user.is_admin) {
      isAdmin = true;
    }
  }
  if(request.cookies.pw && isAdmin) {
    MongoClient.connect(mongouri, mongoOptions, (err1, client) => {
      if(err1) {
        response.status(500);
        response.send('Server Error.\n内部エラーです。申し訳ありません。');
      }else{
        const db = client.db(process.env.DB2);
        const collection = db.collection('mails');
        collection.find().toArray((err2, mails)=>{
          if(err2) {
            response.status(500);
            response.send('Server Error.\n内部エラーです。申し訳ありません。');
          }else{
            response.send(mails);
          }
        });
      }
    });
  }else{
    response.sendStatus(400);
  }
});
*/

/*
app.get('/getonetimepw', function(request, response) {
  response.send(getOneTimePw(8));
});
*/

function getOneTimePw(len) {
  // return = Math.random().toString(36).slice(-8); // 大文字が入らないのでいまいち
  let r = '';

  /*
  let c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!-&%$#*$&*+()=';
  let cl = c.length;
  for(let i = 0; i < len; i++){
    r += c[Math.floor(Math.random()*cl)];
  }
  */
  let min = 33;
  let max = 126;
  for(let i = 0; i < len; i++) {
    r += String.fromCharCode(Math.floor(Math.random() * (max + 1 - min)) + min);
  }
  return r;
}

function getNowYMD(dt){
  let year = dt.getFullYear();
  let month = ('00' + (dt.getMonth()+1)).slice(-2);
  let day = ('00' + dt.getDate()).slice(-2);
  let hour = ('00' + dt.getHours()).slice(-2);
  let minute = ('00' + dt.getMinutes()).slice(-2);
  let result = year + '' + month + '' + day + '' + hour + '' + minute;
  return result;
}


app.get('/findduplicate', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }

  response.send('OK');
  MongoClient.connect(mongouri, mongoOptions, (error, client) => {
    const db = client.db(process.env.DB);

    const userCol = db.collection('users');
    userCol.find({}).toArray((err, users)=>{
      console.log(users.length);
      for(let i = 0; i < users.length; i++) {
        for(let j = i + 1; j < users.length; j++) {
          if(users[i].name == users[j].name) {
            console.log(users[i].name, users[j].name);
          }
        }
      }
      client.close();
    });
  });
});

// query.id で示すユーザ ID の回答がいくつあるか
// app.get('/aulet', function (request, response) {
//   if(!request.secure) {
//     response.redirect('https://' + request.headers.host + request.url);
//     return;
//   }
//   let userId = parseInt(request.query.id);

//   response.send('OK');
//   MongoClient.connect(mongouri, mongoOptions, (error, client) => {
//     const db = client.db(process.env.DB);

//     const ansCol = db.collection('answers');
//     ansCol.find({user_id:{$eq:userId}}).toArray((err2, answers)=>{
//       console.log(answers.length);
//     });
//   });
// });

// // answer.user_id を user.id ではなく user._id にする
// app.get('/migration1', function (request, response) {
//   if(!request.secure) {
//     response.redirect('https://' + request.headers.host + request.url);
//     return;
//   }

//   response.send('OK');
//   MongoClient.connect(mongouri, mongoOptions, (error, client) => {
//     const db = client.db(process.env.DB);

//     const userCol = db.collection('users');
//     userCol.find({}).toArray((err2, users)=>{
//       const ansCol = db.collection('answers');
//       for(let i in users) {
//         const userId = users[i].id;
//         ansCol.updateMany({user_id:{$eq:userId}}, {$set:{user_id: users[i]._id}},(error, results)=>{
//           console.log('OK');
//           client.close();
//         });
//       }
//     });
//   });
// });

// // odai.user_id を user.id ではなく user._id にする
// app.get('/migration2', function (request, response) {
//   if(!request.secure) {
//     response.redirect('https://' + request.headers.host + request.url);
//     return;
//   }

//   response.send('OK');
//   MongoClient.connect(mongouri, mongoOptions, (error, client) => {
//     const db = client.db(process.env.DB);

//     const userCol = db.collection('users');
//     userCol.find({}).toArray((err2, users)=>{
//       const odaiCol = db.collection('odais');
//       for(let i in users) {
//         const userId = users[i].id;
//         odaiCol.updateMany({user_id:{$eq:userId}}, {$set:{user_id: users[i]._id}},(error, results)=>{
//           console.log('OK');
//           client.close();
//         });
//       }
//     });
//   });
// });

// // videoEditedBy を更新
// app.get('/migration3', function (request, response) {
//   if(!request.secure) {
//     response.redirect('https://' + request.headers.host + request.url);
//     return;
//   }

//   response.send('OK');
//   MongoClient.connect(mongouri, mongoOptions, (error, client) => {
//     const db = client.db(process.env.DB);

//     const userCol = db.collection('users');
//     userCol.find({}).toArray((err2, users)=>{
//       const odaiCol = db.collection('odais');
//       for(let i in users) {
//         const userId = users[i].id;
//         odaiCol.updateMany({videoEditedBy:{$eq:userId}}, {$set:{videoEditedBy: users[i]._id}},(error, results)=>{
//           response.status(200);
//           response.send('hello');
//           client.close();
//         });
//       }
//     });
//   });
// });

// // answer の odai_id を odai の _id に
// app.get('/migration4', function (request, response) {
//   if(!request.secure) {
//     response.redirect('https://' + request.headers.host + request.url);
//     return;
//   }
//   response.send('OK');
//   MongoClient.connect(mongouri, mongoOptions, (error, client) => {
//     const db = client.db(process.env.DB);
//     const odaiCol = db.collection('odais');
//     odaiCol.find({}).toArray((err2, odais)=>{
//       const ansCol = db.collection('answers');
//       for(let i in odais) {
//         const odaiId = odais[i].id;
//         ansCol.updateMany({odai_id:{$eq:odaiId}}, {$set:{odai_id: odais[i]._id}},(error, results)=>{
//           client.close();
//         });
//       }
//     });
//   });
// });

app.get('/package', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }
  if(!request.cookies.user || !request.cookies.user.is_admin) {
    response.sendStatus(400);
    return;
  }

  let odaiId = request.query.odaiId;

  MongoClient.connect(mongouri, mongoOptions, (err, client) => {
    const db = client.db(process.env.DB);

    const odaiCol = db.collection('odais');
    const ansCol = db.collection('answers');
    const userCol = db.collection('users');

    let oid = null;
    try{
      oid = new ObjectID(odaiId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
    }catch(e){}

    const tasks = [];
    tasks.push(find(userCol, {}));
    tasks.push(find(odaiCol, {$or:[{_id:{$eq:odaiId}}, {_id:{$eq:oid}}]}));
    tasks.push(find(ansCol, {$and:[{odai_id:{$eq:odaiId}}, {private:{$ne:true}}]}));

    Promise.all(tasks).then(function (receivedList) {
      const users = receivedList[0];
      const odai = receivedList[1][0];
      const answers = receivedList[2];
      for(let i in users) {
        if(users[i]._id + '' == odai.user_id) {
          odai.user = users[i];
        }
        for(let j in answers) {
          if(users[i]._id + '' == answers[j].user_id) {
            answers[j].user = users[i];
          }
        }
      }
      const retObj = {odai:odai, answers:answers, ansnum:answers.length};

      const json = JSON.stringify(retObj);
      response.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Disposition': 'filename=' + getNowYMD(new Date()) + '.json', 'Content-Length': encodeURIComponent(json).replace(/%../g,'x').length});
      response.write(json);
      response.end();
    }).catch(function(error){
      console.log(error);
      response.status(500);
      response.send(error);
    }).then(function(){
      client.close();
    });
  });
});

app.post('/package', function (request, response) {
  if(!request.secure) {
    response.redirect('https://' + request.headers.host + request.url);
    return;
  }

  if(request.body.token != process.env.WATERMARK) {
    response.sendStatus(400);
    return;
  }

  let odaiId = request.body.odaiId;
  if(!odaiId) {
    response.sendStatus(400);
    return;
  }

  MongoClient.connect(mongouri, mongoOptions, (err, client) => {
    const db = client.db(process.env.DB);

    const odaiCol = db.collection('odais');
    const ansCol = db.collection('answers');
    const userCol = db.collection('users');

    let oid = null;
    try{
      oid = new ObjectID(odaiId); // これで oid で検索可能（const ObjectID = require('mongodb').ObjectID を忘れず
    }catch(e){}

    const tasks = [];
    tasks.push(find(userCol, {}));
    tasks.push(find(odaiCol, {$or:[{_id:{$eq:odaiId}}, {_id:{$eq:oid}}]}));
    tasks.push(find(ansCol, {$and:[{odai_id:{$eq:odaiId}}, {private:{$ne:true}}]}));

    Promise.all(tasks).then(function (receivedList) {
      const users = receivedList[0];
      const odai = receivedList[1][0];
      const answers = receivedList[2];
      for(let i in users) {
        if(users[i]._id + '' == odai.user_id) {
          odai.user = users[i];
        }
        for(let j in answers) {
          if(users[i]._id + '' == answers[j].user_id) {
            answers[j].user = users[i];
          }
        }
      }
      const retObj = {odai:odai, answers:answers, ansnum:answers.length};

      const json = JSON.stringify(retObj);
      response.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Disposition': 'filename=' + getNowYMD(new Date()) + '.json', 'Content-Length': encodeURIComponent(json).replace(/%../g,'x').length});
      response.write(json);
      response.end();
    }).catch(function(error){
      console.log(error);
      response.status(500);
      response.send(error);
    }).then(function(){
      client.close();
    });
  });
});

app.get('/getopens', function(request, response) {
  console.log('getopens');
  MongoClient.connect(mongouri, mongoOptions, (error, client) => {
    const db = client.db(process.env.DB);
    const colOdai = db.collection('odais');
    colOdai.find(
      {date_release:{$lt:Date.now()}}
    ).sort({'date_release':-1}).toArray((error, odais)=>{
      const ids = [];
      for(let i in odais) {
        if((odais[i].date_release < Date.now() && odais[i].date_close > Date.now()) || (odais[i].date_release < Date.now() && !odais[i].date_close)) {
          ids.push(odais[i]._id);
        }
      }
      response.send(ids);
      client.close();
    })
  });
});

app.listen(PORT, () => console.log(`> Ready on http://localhost:${PORT}`));
