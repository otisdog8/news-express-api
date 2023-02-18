// Dotenv
require('dotenv').config()

// Axios
let axios = require("axios").default;

const express = require('express')
const app = express()
const port = 6969

user = process.env.MONGODB_USER
password = process.env.MONGODB_PASS
clusterUrl = process.env.MONGODB_URL

// Get uri for mongodb
const uri = `mongodb+srv://${user}:${password}@${clusterUrl}?retryWrites=true&w=majority`;

const {MongoClient} = require("mongodb");
const client = new MongoClient(uri);

// Cache helper methods
async function getCachedRecord(collection, cacheTime, item) {
    // Check exist in cache
    const database = client.db('cache');
    const dbCollection = database.collection(collection);
    let query = {};
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

    let query = {};
    query[collection] = item;

    await dbCollection.deleteOne(query);

    // Add to cache
    let record = {
        date: Date.now(), data: data,
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
            key: key, limit: parseInt(limit),
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
            key: record.key, limit: record.limit - 1,
        }
        await dbCollection.insertOne(newRecord);
        return record.key;
    }
}

async function generateOptions(type, lang, country, data) {
    // 1-second lag time
    while (Date.now() < lastCheck) {
        await new Promise(r => setTimeout(r, 1000));
    }
    lastCheck = Date.now() + 1000
    // Get rotated API key
    const key = await getAPIKey();

    if (type === "keyword") {
        return {
            method: 'GET', url: 'https://api.newscatcherapi.com/v2/search', params: {
                q: data,
                lang: lang,
                sort_by: 'relevancy',
                page: '1',
                page_size: 100,
                countries: country,
                from: '1 day ago'
            }, headers: {
                'x-api-key': key,
            }
        };
    } else if (type === "category") {
        return {
            method: 'GET', url: 'https://api.newscatcherapi.com/v2/latest_headlines', params: {
                topic: data, lang: lang, page: '1', page_size: 100, countries: country, when: '24h',
            }, headers: {
                'x-api-key': key,
            }
        };
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
    // TODO: trim to 50


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
        str.split
    })

     */

    // Format nicely and return
    let articles = [];
    newscatcherData.articles.forEach((article) => {
        let newArticle = {
            title: article.title, link: article.link, summary: article.summary
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
    // TODO: GPT Processing Pipeline

    // Format nicely and return


    let articles = [];
    newscatcherData.articles.forEach((article) => {
        let newArticle = {
            title: article.title, link: article.link, summary: article.summary
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
            result[input[option]] = await getNewsDataKeyword(input[option], cacheTime, lang, country)
        }
    }

    for (const category of valid_categories) {
        if (input[category]) {
            result[category] = await getNewsDataCategory(category, cacheTime, lang, country)
        }
    }

    return result
}

// Create mail API stuff
const MailToBeSent = require('@sendgrid/mail')

const API_KEY = process.env.TWILIO_KEY;

MailToBeSent.setApiKey(API_KEY)

// Function to send email
async function sendMail(email, html) {
    const mail = {
        to: email, from: 'hack@rooty.dev', subject: 'Hello from Hacks', text: 'Your weekly news feed', html: html,
    };

    try {
        await MailToBeSent.send(mail)
    } catch (error) {
        console.log("Email sending error: " + error)
    }
}

async function sendFormatted(email, data) {
    // TODO: Implement conveting the data to html

}

// Send the email for a particular user if it works
async function sendOne(email) {
    const database = client.db('email');
    const dbCollection = database.collection('users');
    const filter = {
        email: email
    }
    const data = await dbCollection.findOne(filter)
    const feed = await getNewsDataForApi(data)
    await sendFormatted(email, feed)
}

// Send the email for all users
async function sendAll() {
    const database = client.db('email');
    const dbCollection = database.collection('users');
    const users = await dbCollection.find()
    let userArr = [];
    await users.forEach((user) => {
        userArr.push(user)

    })
    for (let i = 0; i < userArr.length; i++) {
        const user = userArr[i]
        const feed = await getNewsDataForApi(user)
        await sendFormatted(user.email, feed)
    }

}

// Handle sending periodically
async function handleSendingPeriodically() {

}

//takes in the user's email, interests from the JSON, store that information in the mongoDB, then generate for immediate use and recurring use
async function handleEmailInterests(data) {
    const database = client.db('email');
    const dbCollection = database.collection('users');
    const filter = {
        email: data.email
    }
    await dbCollection.updateOne(filter, data, {
        upsert: true
    })


}

// Stores email-associated interest data

// Unsubscribe
async function unsubscribe(email) {
    const database = client.db('email');
    const dbCollection = database.collection('users');
}


// TODO: Subscribe link and unsubscribe
app.get('/keyword_test', async (req, res) => {
    try {
        let keyword = req.query.keyword
        let data = await newscatcherGetKeyword(keyword)
        res.json(data);
    } catch {
        res.json({})
    }

})

app.get('/category_test', async (req, res) => {
    try {
        let category = req.query.category
        let data = await newscatcherGetCategory(category)
        res.json(data);
    } catch {
        res.json({})
    }

})

app.use(express.json());
app.post('/generate_feed', async (req, res) => {
    // Check if email field exists

    try {
        const data = await getNewsDataForApi(req.body)

        res.json(data)

        if (req.body.email !== "") {
            const emailFormat = /^[a-zA-Z0-9_.+]+(?<!^[0-9]*)@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
            if (req.body.email.match((emailFormat))) {
                try {
                    await handleEmailInterests(req.body)
                } catch (error) {
                    console.log("Error in email send: " + error)
                }
            }
        }
    } catch {
        res.json({})
    }
})


app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
