// Dotenv
require('dotenv').config()

// Axios
var axios = require("axios").default;

const express = require('express')
const app = express()
const port = 6969

user = process.env.MONGODB_USER
password = process.env.MONGODB_PASS
clusterUrl = process.env.MONGODB_URL

// Get uri for mongodb
const uri =
    `mongodb+srv://${user}:${password}@${clusterUrl}?retryWrites=true&w=majority`;

const {MongoClient} = require("mongodb");
const client = new MongoClient(uri);

async function newscatcherGetKeyword(keyword, cacheTime = 4, lang = "en", country = "US") {
    // Check exist in cache
    const database = client.db('cache');
    const kwcollection = database.collection('keyword');
    const query = {keyword: keyword};
    const cached = await kwcollection.findOne(query);
    if (cached !== null) {
        const hour = 1000 * 60 * 60;
        const cacheValidInterval = Date.now() - hour * cacheTime;
        if (cached.date > cacheValidInterval) {
            return cached.data;
        }
    }
    await kwcollection.deleteOne(query);

    // Make newscatcher API query


    const options = {
        method: 'GET',
        url: 'https://api.newscatcherapi.com/v2/search',
        params: {
            q: keyword,
            lang: lang,
            sort_by: 'relevancy',
            page: '1',
            from: '1 day ago',
            page_size: 100,
            countries: [country]
        },
        headers: {
            'x-api-key': process.env.NEWSCATCHER_KEY
        }
    };

    // TODO: error handling
    const response = await axios.request(options)

    const data = response.data

    // Add to cache
    const record = {
        keyword : keyword,
        date : Date.now(),
        data : data,
    }

    await kwcollection.insertOne(record);

    return data;
}

function newscatcherGetCategory(category, cacheTime = 4) {

}

app.get('/', async (req, res) => {
    res.send('Hello World!')
})


// Function to get a subcomponent of newsletter
function getNewsData() {

}

// Function to get full newsletter stuff


app.get('/newscatcher_test', async (req, res) => {
    keyword = req.query.keyword
    data = await newscatcherGetKeyword(keyword)
    res.send(data);
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
