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

// TODO: After the hackathon, purposefully nerf features (caching, async paralellization), to get bullet points about numerical speedups

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
        let auth = req.query.auth
        if (auth !== process.env.APIROTATION_AUTH) {
            res.send("Invalid API Key Auth")
            return
        }
        // Save key with limit to mongodb
        const database = client.db('apikeyrotate');
        const dbCollection = database.collection("newscatcher");
        const record = {
            key: key, limit: parseInt(limit),
        }

        await dbCollection.insertOne(record)

        res.send("API Key added")
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

// Openai setup thing

const {Configuration, OpenAIApi} = require("openai");

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Title fuzzy matching setup
const Fuse = require('fuse.js')

// Function to get a subcomponent of newsletter
async function getNewsDataKeyword(keyword, cacheTime = 4, lang = "en", country = "US", ncCacheTime = 4) {
    // Check exist in cache
    const cachedItem = await getCachedRecord("processedKeyword", cacheTime, keyword)
    if (cachedItem !== null) {
        return cachedItem.slice(0, Math.min(3, cachedItem.length));
    }

    // Newscatcher API
    const newscatcherData = await newscatcherGetKeyword(keyword, ncCacheTime, lang, country);

    // Collect a list of articles to group:
    let articleArr = []
    articleArr = newscatcherData.articles.filter((article) => {
        return article.summary !== null && article.summary.length >= 250 && article.summary.length <= 1000
    })
    articleArr = articleArr.slice(0, Math.min(articleArr.length, 50))

    const promptBase = "Pick only 3 the most relevant articles, highlighting current events, politics, and breaking news. Do not choose any articles related to sports, and ensure that the articles are not repetitive. Do not include duplicates or articles that likely refer to the same event:\n"
    let prompt = promptBase
    let cnt = 1
    articleArr.forEach((article) => {
        prompt += cnt.toString() + ": " + article.title + "\n"
        cnt += 1;
    })

    prompt += "\n" + promptBase
    // GPT3 processing
    const completion = await openai.createCompletion({
        model: "text-davinci-003", prompt: prompt, max_tokens: 256,
    });

    // Extract titles from completion
    const options = {
        includeScore: true, keys: ["title"],
    }

    const fuse = new Fuse(articleArr, options)

    let articleMatch = []
    completion.data.choices[0].text.split('\n').forEach((str) => {
        if (str.startsWith("1") || str.startsWith("2") || str.startsWith("3")) {
            try {
                const searchStr = str.split(":").slice(1).join(":").trim();
                const result = fuse.search(searchStr)[0].item
                articleMatch.push(result)
            } catch {

            }
        }
    });

    if (articleMatch.length === 0) {
        let articles = [];
        articleArr.slice(0, Math.min(3, articleArr.length)).forEach((article) => {
            let newArticle = {
                title: article.title, link: article.link, summary: article.summary
            }
            articles.push(newArticle)
        })
        return articles;
    }

    let articleCoroArr = []
    // Process summaries with gpt3
    for (const article of articleMatch) {
        let summarizePrompt = "Summarize the following in 250 words or less: \n"
        summarizePrompt += article.summary
        summarizePrompt += "\nSummary:\n"
        articleCoroArr.push(openai.createCompletion({
            model: "text-davinci-003", prompt: summarizePrompt, max_tokens: 256,
        }));
    }

    for (let i = 1; i < articleMatch.length; i++) {
        articleMatch[i].summary = (await articleCoroArr[i]).data.choices[0].text
    }

    // Format nicely and return
    let articles = [];
    articleMatch.forEach((article) => {
        let newArticle = {
            title: article.title, link: article.link, summary: article.summary
        }
        articles.push(newArticle)
    })

    await refreshCacheRecord("processedKeyword", articles, keyword)

    return articles.slice(0, Math.min(3, articles.length));
}

async function getNewsDataCategory(category, cacheTime = 4, lang = "en", country = "US", ncCacheTime = 4) {
    // Check exist in cache
    const cachedItem = await getCachedRecord("processedCategory", cacheTime, category)
    if (cachedItem !== null) {
        return cachedItem.slice(0, Math.min(3, cachedItem.length));
    }

    // Newscatcher API
    const newscatcherData = await newscatcherGetCategory(category, ncCacheTime, lang, country);

    let articleArr = []
    articleArr = newscatcherData.articles.filter((article) => {
        return article.summary !== null && article.summary.length >= 250 && article.summary.length <= 1000
    })
    articleArr = articleArr.slice(0, Math.min(articleArr.length, 50))

    const promptBase = "Pick only 3 the most relevant articles, highlighting current events. Ensure that the articles are not repetitive. Do not include duplicates or articles that likely refer to the same event:\n"
    let prompt = promptBase
    let cnt = 1
    articleArr.forEach((article) => {
        prompt += cnt.toString() + ": " + article.title + "\n"
        cnt += 1;
    })

    prompt += "\n" + promptBase
    // GPT3 processing
    const completion = await openai.createCompletion({
        model: "text-davinci-003", prompt: prompt, max_tokens: 256,
    });

    // Extract titles from completion
    const options = {
        includeScore: true, keys: ["title"],
    }

    const fuse = new Fuse(articleArr, options)

    let articleMatch = []
    completion.data.choices[0].text.split('\n').forEach((str) => {
        if (str.startsWith("1") || str.startsWith("2") || str.startsWith("3")) {
            try {
                const searchStr = str.split(":").slice(1).join(":").trim();
                const result = fuse.search(searchStr)[0].item
                articleMatch.push(result)
            } catch {

            }
        }
    });

    if (articleMatch.length === 0) {
        let articles = [];
        articleArr.slice(0, Math.min(3, articleArr.length)).forEach((article) => {
            let newArticle = {
                title: article.title, link: article.link, summary: article.summary
            }
            articles.push(newArticle)
        })
        return articles;
    }

    let articleCoroArr = []
    // Process summaries with gpt3
    for (const article of articleMatch) {
        let summarizePrompt = "Summarize the following in 250 words or less: \n"
        summarizePrompt += article.summary
        summarizePrompt += "\nSummary:\n"
        articleCoroArr.push(openai.createCompletion({
            model: "text-davinci-003", prompt: summarizePrompt, max_tokens: 256,
        }));
    }

    for (let i = 1; i < articleMatch.length; i++) {
        articleMatch[i].summary = (await articleCoroArr[i]).data.choices[0].text
    }

    // Format nicely and return
    let articles = [];
    articleMatch.forEach((article) => {
        let newArticle = {
            title: article.title, link: article.link, summary: article.summary
        }
        articles.push(newArticle)
    })

    await refreshCacheRecord("processedCategory", articles, category)

    return articles.slice(0, Math.min(3, articles.length));
}

// Function to get full newsletter stuff
async function getNewsDataForApi(input, cacheTime = 4, lang = "en", country = "US") {
    let result = {}

    const kwOptions = ["location", "interest1", "interest2", "interest3"]

    for (const option of kwOptions) {
        if (input[option] !== "") {
            result[input[option]] = getNewsDataKeyword(input[option], cacheTime, lang, country)
        }
    }

    for (const category of valid_categories) {
        if (input[category]) {
            result[category] = getNewsDataCategory(category, cacheTime, lang, country)
        }
    }

    for (const option of kwOptions) {
        if (input[option] !== "") {
            result[input[option]] = await result[input[option]]
        }
    }

    for (const category of valid_categories) {
        if (input[category]) {
            result[category] = await result[category]
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
        to: email, from: 'news@mynewswire.tech', subject: 'Hello from Hacks', text: 'Your weekly news feed', html: html,
    };

    try {
        await MailToBeSent.send(mail)
    } catch (error) {
        console.log("Email sending error: " + error)
    }
}

async function sendFormatted(email, data) {
    let result = "";

    const prefix = "<div style='text-align: center; background-color: rgb(211, 211, 211);'> <div class='box' style='position: relative;background:#f8f8f8;width: 90%;max-width: 900px;padding: 2em;margin: 1.5em aut;border: 3px solid rgba(0, 0, 0, 0.08); margin:auto'><div class='newsletterContent' id='newsLetterBox'><h1 style='text-align:center; font-size:60px; tex-transform:uppercase; color:#222; letter-spacing:1px;font-family:'Playfair Display', serif; font-weight:400;'>MyNewsWire</h1><HR style='border-top: 1px dashed;'>"
    result = result.concat(prefix);

    for (const key in data) {
        let content = `<div class='article' style='padding-bottom: 10px;'><HR style='border-top: 1px dashed;'><h2 style='text-align: left !important; margin-top: 0px; margin-bottom: -30px; font-size: 30px !important; text-transform: none !important; font-family:' Playfair Display', serif; font-weight:500; margin-bottom: 15px;' class='category'>Today in ${key}<span id='technology'></span></h2>`

        for (let i = 0; i < 3; i++) {
            const articleObject = data[key][i];
            const article_title = articleObject["title"];
            const article_url = articleObject["link"];
            const article_content = articleObject["summary"];

            const articleToAdd = `<h2 style='text-align:center; font-size:25px;text-transform:uppercase; color:#222; letter-spacing:1px;font-family:' Playfair Display', serif; font-weight:400; margin-bottom: 15px;'><a style='color: navy; text-decoration: none; border-bottom: 3px dotted navy;' href=${article_url}>${article_title}</a></h2><p>${article_content}</p>`

            content = content.concat(articleToAdd);

        }
        result = result.concat(content);
        const endDiv = "</div>";
        content = content.concat(endDiv);
    }

    let suffix = "</div><HR style='border-top: 1px dashed;'><nav class='navbar' style='align-items: center; justify-content: space-between;background-color: rgb(159, 159, 190); height: 30px;'><ul style='padding-left: -30px; margin-left: -60px;'><li style='list-style-type: none; padding-left: 10px;display:inline;'><a style='color: navy; text-decoration: none; border-bottom: 3px dotted navy;' href='url'>About us</a></li><li style='list-style-type: none; padding-left: 10px;display:inline;'><a style='color: navy; text-decoration: none; border-bottom: 3px dotted navy;' href='url'>Subscription settings</a></li><li style='list-style-type: none; padding-left: 10px;display:inline;'><a style='color: navy; text-decoration: none; border-bottom: 3px dotted navy;' href="
    suffix += `https://hackapi.rooty.dev/unsubscribe?email=${email}`
    suffix += ">Unsubscribe</a></li></ul></nav></div></div>"
    result = result.concat(suffix);

    await sendMail(email, result);
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

let jobStarted = false;

// Handle sending periodically
async function handleSendingPeriodically() {
    if (jobStarted) {
        return
    }
    jobStarted = true;
    // Set the time for Eastern Time
    const targetTime = new Date().setUTCHours(19, 0, 0, 0);

    const delay = targetTime - Date.now();

    // If the delay is negative, the target time has already passed for today,
    const nextDelay = delay < 0 ? delay + 24 * 60 * 60 * 1000 : delay;

    const sendTimer = async () => {
        await sendAll();
        while (true) {
            await new Promise(r => setTimeout(r, 24 * 60 * 60 * 1000));
            await sendAll();
        }
    }
    // Call sendAll() after the calculated delay
    setTimeout(sendTimer, nextDelay);
}

//takes in the user's email, interests from the JSON, store that information in the mongoDB, then generate for immediate use and recurring use
async function handleEmailInterests(data) {
    const database = client.db('email');
    const dbCollection = database.collection('users');
    const filter = {
        email: data.email
    }
    await dbCollection.updateOne(filter, {$set: data}, {
        upsert: true
    })

    await sendOne(data.email)
}

// Stores email-associated interest data

// Unsubscribe
async function unsubscribe(email) {
    const database = client.db('email');
    const dbCollection = database.collection('users');
    const filter = {
        email: email
    }

    await dbCollection.deleteOne(filter)

}

app.get('/unsubscribe', async (req, res) => {
    try {
        await unsubscribe(req.query.email)
        res.send("Successfully unsubscribed")
    } catch (err) {
        console.log("Error in unsubscribe: " + err)
        res.send("An error occurred")
    }
})

app.use(express.json());
app.post('/generate_feed', async (req, res) => {
    // Check if email field exists

    try {
        const data = await getNewsDataForApi(req.body)

        try {
            await new Promise(r => setTimeout(r, 1000));
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
        } catch (err) {
            console.log("Error in email code: " + err)
        }
    } catch {
        res.json({})
    }
})


app.listen(port, async () => {
    await handleSendingPeriodically()
    console.log(`Example app listening on port ${port}`)
})
