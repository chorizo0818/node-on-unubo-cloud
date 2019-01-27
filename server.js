var http = require('http');
var port = process.env.PORT || 5000;

http.createServer(function (req, res) {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Welcome to Node.js on Unubo Cloud');
}).listen(port, function() {
  console.log('> Ready on http://localhost:' + port);
});
