require('dotenv').config();

const PORT = process.env.PORT || 3000;

let express = require('express');
let app = express();

// http://expressjs.com/en/starter/basic-routing.html
app.get('/', function (request, response) {
  response.sendFile(path.join(__dirname + '/views/index.html'));
});

app.listen(PORT, () => console.log(`> Ready on http://localhost:${PORT}`));
