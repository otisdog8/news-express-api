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

// Cache helper methods
async function getCachedRecord(collection, cacheTime, item) {
    // Check exist in cache
    const database = client.db('cache');
    const dbCollection = database.collection(collection);
    var query = {};
    query[collection] = item

    const cached = await dbCollection.findOne(query);
    if (cached !== null) {
        const hour = 1000 * 60 * 60;
        const cacheValidInterval = Date.now() - hour * cacheTime;
        if (cached.date > cacheValidInterval) {
            return cached.data;
        }
    }
    return null;
}


async function refreshCacheRecord(collection, data, item) {
    const database = client.db('cache');
    const dbCollection = database.collection(collection);

    var query = {};
    query[collection] = item;

    await dbCollection.deleteOne(query);

    // Add to cache
    let record = {
        date: Date.now(),
        data: data,
    }

    record[collection] = item;

    await dbCollection.insertOne(record);
}

let lastCheck = Date.now();

app.get('/add_newscatcher_key', async (req, res) => {
    try {
        let key = req.query.key
        let limit = req.query.limit
        // Save key with limit to mongodb
        const database = client.db('apikeyrotate');
        const dbCollection = database.collection("newscatcher");
        const record = {
            key: key,
            limit: parseInt(limit),
        }

        await dbCollection.insertOne(record)
    } catch {
        res.send("Error caught")
    }
})


async function getAPIKey() {
    const database = client.db('apikeyrotate');
    const dbCollection = database.collection("newscatcher");

    const record = await dbCollection.findOne()

    if (record == null) {
        return process.env.NEWSCATCHER_KEY;
    }

    await dbCollection.deleteOne(record)

    if (record.limit === 1) {
        return record.key;
    } else {
        const newRecord = {
            key: record.key,
            limit: record.limit - 1,
        }
        await dbCollection.insertOne(newRecord);
        return record.key;
    }
}

async function generateOptions(type, lang, country, data) {
    // 1 second lag time
    while (Date.now() < lastCheck) {
        await new Promise(r => setTimeout(r, 1000));
    }
    lastCheck = Date.now() + 1000
    // Get rotated API key
    const key = await getAPIKey();

    if (type === "keyword") {
        const options = {
            method: 'GET',
            url: 'https://api.newscatcherapi.com/v2/search',
            params: {
                q: data,
                lang: lang,
                sort_by: 'relevancy',
                page: '1',
                page_size: 100,
                countries: country,
                from: '1 day ago'
            },
            headers: {
                'x-api-key': key,
            }
        };
        return options;
    } else if (type === "category") {
        const options = {
            method: 'GET',
            url: 'https://api.newscatcherapi.com/v2/latest_headlines',
            params: {
                topic: data,
                lang: lang,
                page: '1',
                page_size: 100,
                countries: country,
                when: '24h',
            },
            headers: {
                'x-api-key': key,
            }
        }
        return options;
    }

}


async function newscatcherGetKeyword(keyword, cacheTime = 4, lang = "en", country = "US") {
    // Check exist in cache
    const cachedItem = await getCachedRecord("keyword", cacheTime, keyword)
    if (cachedItem !== null) {
        return cachedItem
    }

    // Make newscatcher API query
    let response;
    const options = await generateOptions("keyword", lang, country, keyword)

    try {
        response = await axios.request(options)
    } catch (error) {
        console.log("Request error: " + error)
        return
    }

    const data = response.data

    await refreshCacheRecord("keyword", data, keyword)

    return data;
}

const valid_categories = ["news", "sport", "tech", "world", "finance", "politics", "business", "economics", "entertainment", "beauty", "travel", "music", "food", "science", "gaming", "energy"]

async function newscatcherGetCategory(category, cacheTime = 4, lang = "en", country = "US") {
    if (!valid_categories.includes(category)) {
        return "Invalid Input";
    }

    // Check exist in cache
    const cachedItem = await getCachedRecord("category", cacheTime, category)
    if (cachedItem !== null) {
        return cachedItem
    }

    // Make newscatcher API query
    let response;

    const options = await generateOptions("category", lang, country, category)

    try {
        response = await axios.request(options)
    } catch (error) {
        console.log("Request error: " + error)
        return
    }

    const data = response.data

    await refreshCacheRecord("category", data, category)

    return data;
}

app.get('/', async (req, res) => {
    res.send('Hello World!')
})

// TODO: OpenAI Processing pipeline
// Openai setup thing
/*
const {Configuration, OpenAIApi} = require("openai");

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

 */

// Function to get a subcomponent of newsletter
async function getNewsDataKeyword(keyword, cacheTime = 4, lang = "en", country = "US", ncCacheTime = 4) {
    // Check exist in cache
    const cachedItem = await getCachedRecord("processedKeyword", cacheTime, keyword)
    if (cachedItem !== null) {
        return cachedItem.slice(0, 3)
    }

    // Newscatcher API
    const newscatcherData = await newscatcherGetKeyword(keyword, ncCacheTime, lang, country);

    // Collect a list of articles to group:
    /*
    prompt = ""
    cnt = 1
    newscatcherData.articles.forEach((article) => {
        prompt += cnt.toString() + ": " + article.title + "\n"
        cnt += 1;
    })

    prompt += "Above is a list of articles. Select the 3-5 most relevant articles, highlighting current events that would be interesting to a local. Do not include duplicates or articles that likely refer to the same event:\n"
    // GPT3 processing
    const completion = await openai.createCompletion({
        model: "text-davinci-003",
        prompt: prompt,
    });

    completion.split('\n').forEach((str) => {
        str.spli
    })

     */

    // Format nicely and return
    let articles = [];
    newscatcherData.articles.forEach((article) => {
        let newArticle = {
            title: article.title,
            link: article.link,
            summary: article.summary
        }
        articles.push(newArticle)
    })

    await refreshCacheRecord("processedKeyword", articles, keyword)

    return articles.slice(0, 3);
}

async function getNewsDataCategory(category, cacheTime = 4, lang = "en", country = "US", ncCacheTime = 4) {
    // Check exist in cache
    const cachedItem = await getCachedRecord("processedCategory", cacheTime, category)
    if (cachedItem !== null) {
        return cachedItem.slice(0, 3)
    }

    // Newscatcher API
    const newscatcherData = await newscatcherGetCategory(category, ncCacheTime, lang, country);

    // GPT3 processing
    // TODO: GPT Processing Pipelineu

    // Format nicely and return


    let articles = [];
    newscatcherData.articles.forEach((article) => {
        let newArticle = {
            title: article.title,
            link: article.link,
            summary: article.summary
        }
        articles.push(newArticle)
    })

    await refreshCacheRecord("processedCategory", articles, category)

    return articles.slice(0, 3);
}

// Function to get full newsletter stuff
async function getNewsDataForApi(input, cacheTime = 4, lang = "en", country = "US") {
    let result = {}

    const kwOptions = ["location", "interest1", "interest2", "interest3"]

    for (const option of kwOptions) {
        if (input[option] !== "") {
            result[option] = await getNewsDataKeyword(input[option], cacheTime, lang, country)
        }
    }

    for (const category of valid_categories) {
        if (input[category]) {
            result[category] = await getNewsDataCategory(category, cacheTime, lang, country)
        }
    }

    return result
}

app.get('/keyword_test', async (req, res) => {
    try {
        keyword = req.query.keyword
        data = await newscatcherGetKeyword(keyword)
        res.json(data);
    } catch {
        res.json({})
    }

})

app.get('/category_test', async (req, res) => {
    try {
        category = req.query.category
        data = await newscatcherGetCategory(category)
        res.json(data);
    } catch {
        res.json({})
    }

})

app.use(express.json());
app.post('/generate_feed', async (req, res) => {
    // TODO: Email logic
    try {
        res.json(await getNewsDataForApi(req.body))
    } catch {
        res.json({})
    }
})


app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
