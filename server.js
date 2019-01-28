const app = require('express')();
const path = require('path');
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname + '/index.html'));
});

app.listen(PORT, () => console.log(`> Ready on http://localhost:${PORT}`));
