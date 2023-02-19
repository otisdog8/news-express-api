## Inspiration
---
Many of us are very interested in news, politics, and journalism. We realized that we could develop a hack to a daily problem that we face when reading the news. It is difficult to filter and categorize news based on our interests and get the news that we like in the form of a readily accessible newsletter delivered by mail. Taking cognizance of this issue, we at mynewswire.tech came up with a way to solve this issue. 

## What it does
---
MyNewsWire allows you to get relevant news on topics you like that go beyond just a Google search. It allows users to get customized news in one click. Users can select their location and interests to get the most recent news and subscribe to our email newsletter for a daily dose of customized news feeds.

## How we built it
---
### Front end
The web application, built using **React JS**, uses reusable components that are rendered conditionally. It sends data submitted from the form to the backend using a **REST API** end-point and waits for the news feed results to be returned as a **JSON** file, which is dynamically rendered on the web page. Even the formatting for the email was done with a combination of **HTML** and **CSS**.

### Back end
We used **Node+Express** for the core of our API. For hosting, we used a **Google Compute Engine VPS** on **Debian 11** with **Nginx** acting as a reverse proxy and handling SSL for the front end. We used **Cloudflare** to manage DNS and SSL for the backend API. We used **NewsCatcher’s API** to collect news articles from the last 24 hours. Once we got results from **NewsCatcher**, we used **GPT3** to curate the articles (reduce ~50 articles to 3) and also shorten and improve the summary provided by **NewsCatcher**. 

Because these API calls can take a long time and be expensive, we used **MongoDB Atlas** to cache the results from these APIs for about four hours. We also used **MongoDB** to store user preferences for our newsletter and to handle API Key rotation for newscatcher (see challenges). 

Our backend also uses **Twilio SendGrid** to handle sending emails. To send an email, the backend first fetches user interests from **MongoDB**, generates a **JavaScript** object with a personalized newsfeed, converts the newsfeed to **HTML**, and finally sends a nicely formatted email to the user. 

## Challenges we ran into
---
Early on, we ran into an issue with newscatcher, the API we would use. The site said we had 10k free API calls, but it turns out we only had 50 (per API key). So, we had to implement aggressive caching to minimize our API usage. Later on in development, we used MongoDB Atlas to store a series of API keys as well as the number of remaining API calls for that API key and queried the database whenever we needed a key, which allowed us to increase the number of API calls we could make without too much manual intervention. The API also had a one-call-per-second rate limit, so we needed to add a wrapper function that queued calls to keep within the limit using async.

Another challenge was that GPT3 API calls take a long time to run, leading to long waiting times on requests. To resolve this, we added caching to the GPT3 component and used async/await to call the API multiple times simultaneously. Although OpenAI also has a similar rate limit to newscatcher (60 requests per second), it calculates this over the whole minute, so we could burst up to about 40 requests at one time and wait for them all to complete. 

A final issue that we had was that it was difficult to parse the output from GPT3; although we asked it in the prompt to return the titles of the articles it had selected, it made slight edits that made it difficult to match using string equality. To resolve this, we used the fuse.js package to fuzzy-match instead of exact match, which made it work perfectly. 

## Accomplishments that we're proud of
---
This was the first hackathon for our entire team. Just the day before yesterday, we didn’t even know what to expect from the hackathon as both a learning experience and the end product we would deliver. As a part of this hackathon, we all got exposed to and learned different industry relevant technologies.

We collaborated extensively and learned from each other’s strengths. Some team members were strong with front-end development, whereas others were strong with back-end development. It was interesting to see how the integration between various components and the development of the final product came into being.

## What we learned
---
As this was our first hackathon, we learned several lessons that could apply to future hackathons. We realized that collaboration is crucial to success and that effective communication and teamwork are essential to creating a successful hack. Having only 36 hours working in a team 4 posed a significant challenge - getting relevant key tasks done in a timely manner and distributing the work efficiently was difficult. The hackathon environment also sparked our creativity, and we discovered that coming up with innovative solutions to crucial problems was crucial to success. Overall, our first hackathon was an enjoyable experience, and we look forward to applying these lessons to future projects and hackathons.

From a technical perspective, we all improved our abilities to work on various parts of the MERN stack and with JavaScript and APIs in general. We also improved our skills in Git and GitHub. Lastly, we learned a great deal about how to work around usage limitations in APIs, which were common as we primarily used free trials.

## What's next for MyNewsWire
---
From now on, there are several routes we can take. One thing we can do is expand the functionality of our site. Newscatcher can be extended to support various other languages and other countries, so it’s possible to add support for that. The API can be improved in multiple ways, such as using OpenAI’s API batching to prevent us from running afoul of the 60 requests per minute rate limit or improving abuse protections. Lastly, we can improve the formatting of the email newsletter and website to make it more aesthetically pleasing and mobile-friendly. After a bit of code cleanup, others would be able to make meaningful changes to both the backend and front end.


