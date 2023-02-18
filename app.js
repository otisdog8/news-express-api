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
    const kwCollection = database.collection('keyword');
    const query = {keyword: keyword};
    const cached = await kwCollection.findOne(query);
    if (cached !== null) {
        const hour = 1000 * 60 * 60;
        const cacheValidInterval = Date.now() - hour * cacheTime;
        if (cached.date > cacheValidInterval) {
            return cached.data;
        }
    }
    await kwCollection.deleteOne(query);

    // Make newscatcher API query

    let response;

    // TODO: mongo API key rotating
    const options = {
        method: 'GET',
        url: 'https://api.newscatcherapi.com/v2/search',
        params: {
            q: keyword,
            lang: lang,
            sort_by: 'relevancy',
            page: '1',
            page_size: 100,
            countries: country,
            from: '1 day ago'
        },
        headers: {
            'x-api-key': process.env.NEWSCATCHER_KEY
        }
    };

    // TODO: error handling
    try {
        response = await axios.request(options)
    } catch (error) {
        console.log("Request error: " + error)
        return
    }

    const data = response.data

    // Add to cache
    const record = {
        keyword: keyword,
        date: Date.now(),
        data: data,
    }

    await kwCollection.insertOne(record);

    return data;
}

const valid_categories = ["news", "sport", "tech", "world", "finance", "politics", "business", "economics", "entertainment", "beauty", "travel", "music", "food", "science", "gaming" , "energy"]

async function newscatcherGetCategory(category, cacheTime = 4, lang = "en", country = "US") {
    if (!valid_categories.includes(category)) {
        return "Invalid Input";
    }
    // Check exist in cache
    const database = client.db('cache');
    const cCollection = database.collection('category');
    const query = {category: category};
    const cached = await cCollection.findOne(query);
    if (cached !== null) {
        const hour = 1000 * 60 * 60;
        const cacheValidInterval = Date.now() - hour * cacheTime;
        if (cached.date > cacheValidInterval) {
            return cached.data;
        }
    }
    await cCollection.deleteOne(query);

    // Make newscatcher API query

    let response;

    // TODO: mongo API key rotating
    const options = {
        method: 'GET',
        url: 'https://api.newscatcherapi.com/v2/latest_headlines',
        params: {
            topic: category,
            lang: lang,
            page: '1',
            page_size: 100,
            countries: country,
            when: '24h',
        },
        headers: {
            'x-api-key': process.env.NEWSCATCHER_KEY
        }
    };

    // TODO: error handling
    try {
        response = await axios.request(options)
    } catch (error) {
        console.log("Request error: " + error)
        return
    }

    const data = response.data

    // Add to cache
    const record = {
        category: category,
        date: Date.now(),
        data: data,
    }

    await cCollection.insertOne(record);

    return data;
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

app.get('/category_test', async (req, res) => {
    category = req.query.category
    console.log(category)
    data = await newscatcherGetCategory(category)
    res.send(data);
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
