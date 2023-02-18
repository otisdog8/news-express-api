const express = require('express')
const app = express()
const port = 6969

app.get('/', (req, res) => {
  res.send('Hello World!')
})

// Function to get a subcomponent of newsletter
function getNewsData() {

}

// Function to get full newsletter stuff


app.get('/', (req, res) => {
  res.send("Result");
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
