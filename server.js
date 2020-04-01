const app = require('express')();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.listen(PORT, () => console.log(`> Ready on http://localhost:${PORT}`));
