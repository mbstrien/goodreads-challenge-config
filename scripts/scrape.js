#!/usr/bin/env node
const https = require("https");
const fs    = require("fs");
const path  = require("path");

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const BLOG_URL    = process.env.BLOG_URL || "https://www.goodreads.com/blog/show/3093";
const OUT_FILE    = path.join(__dirname, "..", "challenges.json");

if (!APIFY_TOKEN) { console.error("APIFY_TOKEN is required"); process.exit(1); }

function apifyPost(p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: "api.apify.com", path: p, method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${APIFY_TOKEN}`, "Content-Length": Buffer.byteLength(data) },
    }, res => { let r=""; res.on("data",c=>r+=c); res.on("end",()=>resolve(JSON.parse(r))); });
    req.on("error", reject); req.write(data); req.end();
  });
}

function apifyGet(p) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.apify.com", path: p,
      headers: { "Authorization": `Bearer ${APIFY_TOKEN}` },
    }, res => { let r=""; res.on("data",c=>r+=c); res.on("end",()=>resolve(JSON.parse(r))); });
    req.on("error", reject); req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function inferTags(genres = []) {
  const g = genres.map(x => x.toLowerCase()).join(" ");
  const tags = [];
  if (g.includes("cozy"))                         tags.push("cozy");
  if (g.includes("domestic thriller"))            tags.push("domestic-thriller");
  if (g.includes("psychological"))                tags.push("psychological-thriller");
  if (g.includes("historical"))                   tags.push("historical");
  if (g.includes("young adult"))                  tags.push("ya");
  if (g.includes("literary"))                     tags.push("literary");
  if (g.includes("crime") || g.includes("noir"))  tags.push("crime");
  if (g.includes("book") && g.includes("about"))  tags.push("books-about-books");
  if (g.includes("classic"))                      tags.push("classic");
  if (g.includes("legal"))                        tags.push("legal-thriller");
  if (tags.length === 0)                          tags.push("thriller");
  return tags;
}

async function main() {
  console.log("Scraping:", BLOG_URL);
  const run = await apifyPost(
    `/v2/acts/epctex~goodreads-scraper/runs?token=${APIFY_TOKEN}`,
    { startUrls: [{ url: BLOG_URL }], maxItems: 200, includeReviews: false,
      proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] } }
  );
  const runId = run.data.id;
  console.log("Run:", runId);

  let status = "RUNNING";
  while (status === "RUNNING" || status === "READY") {
    await sleep(10000);
    const info = await apifyGet(`/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
    status = info.data.status;
    console.log(" ", status);
  }
  if (status !== "SUCCEEDED") { console.error("Failed:", status); process.exit(1); }

  const datasetId = (await apifyGet(`/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`)).data.defaultDatasetId;
  const items = (await apifyGet(`/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=200`)).items || [];
  console.log("Books scraped:", items.length);

  const existing = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
  const books = items
    .filter(b => b.title && b.url)
    .map(b => {
      const year = b.publishedDate ? new Date(b.publishedDate).getFullYear() : (b.year || 0);
      return { title: b.title, author: b.author||"", year: isNaN(year)?0:year,
               rating: b.rating||0, cover: b.imageUrl||b.image||"",
               url: b.url, tags: inferTags(b.genres), longBook: (b.numPages||0)>=500 };
    })
    .filter(b => b.year > 0)
    .sort((a,b) => b.year - a.year || a.title.localeCompare(b.title));

  const updated = { ...existing,
    _meta: { ...existing._meta, lastUpdated: new Date().toISOString().split("T")[0], bookCount: books.length },
    books };
  fs.writeFileSync(OUT_FILE, JSON.stringify(updated, null, 2));
  console.log("Done:", books.length, "books written");
}

main().catch(err => { console.error(err); process.exit(1); });
