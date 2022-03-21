const assert = require('assert')
const path = require('path')
const fs = require('fs')

const fetch = require('node-fetch')

const htmlparser2 = require('htmlparser2')
const domutils = require('domutils')

const Database = require('better-sqlite3')

const { parse } = require('json2csv')

const getDb = (dbName) => {
  const db = new Database(`${dbName}.sqlite`/*, { verbose: console.log } */)

  const capturesExists = db.prepare('SELECT * FROM sqlite_master WHERE type=\'table\' AND name=\'Captures\'').get() != null

  if (!capturesExists) {
    db.exec(`
      CREATE TABLE "Captures" (
        "wmUrlKey"  TEXT,
        "wmTimestamp" INTEGER,
        "wmOriginal"  TEXT,
        "wmMimetype"  TEXT,
        "wmStatusCode"  INTEGER,
        "wmDigest"  TEXT,
        "wmLength"  INTEGER,
        "username"  TEXT,
        "text"  TEXT,
        PRIMARY KEY("wmDigest")
      );
    `)
  }

  return db
}

// TODO: Add pagination
const fetchWMCaptures = async (db, twitterUsername) => {
  const request = await fetch(`https://web.archive.org/cdx/search/cdx?url=https://twitter.com/${twitterUsername}/status/*&output=json`)
  const jsonResponse = await request.json()

  // Convert from array of arrays to array of objects
  const jsonResponseHeaders = jsonResponse.shift()
  const wmCaptures = jsonResponse.map(arrayCapture => {
    const objectCapture = {}

    for (const iAttribute in arrayCapture) {
      objectCapture[jsonResponseHeaders[iAttribute]] = arrayCapture[iAttribute]
    }

    return objectCapture
  })

  // Insert all captures into the DB in a single transaction
  db.transaction(wmCaptures => {
    for (const wmCapture of wmCaptures) {
      const captureExists = db.prepare('SELECT * FROM Captures WHERE wmDigest = ?').get(wmCapture.digest) != null
      if (captureExists) continue

      db.prepare(`
        INSERT INTO Captures (wmUrlKey, wmTimestamp, wmOriginal, wmMimetype, wmStatusCode, wmDigest, wmLength)
        VALUES (@urlkey, @timestamp, @original, @mimetype, @statuscode, @digest, @length)
      `)
        .run(wmCapture)
    }
  })(wmCaptures)

  return db.prepare('SELECT* FROM Captures').all()
}

const fetchTwCapture = async (db, twitterUsername, wmCapture) => {
  // Return if it's already fetched
  const fetched = db.prepare('SELECT * FROM Captures WHERE wmDigest = ?').get(wmCapture.wmDigest)
  const alreadyFetched = fetched.username != null && fetched.text != null
  if (alreadyFetched) return fetched

  const wmCaptureRequest = await fetch(`https://web.archive.org/web/${wmCapture.wmTimestamp}/${wmCapture.wmOriginal}`)
  const wmCaptureRequestText = await wmCaptureRequest.text()
  const wmCaptureDom = htmlparser2.parseDocument(wmCaptureRequestText)

  const permalinkTweetDom = domutils.findOne(node => {
    return (
      node?.attribs?.class?.includes('permalink-tweet')
    )
  }, wmCaptureDom.childNodes, true)

  // Get the username
  const permalinkHeaderDom = domutils.findOne(node => {
    return (
      node?.attribs?.class?.includes('permalink-header')
    )
  }, permalinkTweetDom.childNodes, true)
  const permalinkUsernameDom = domutils.findOne(node => {
    return (
      node?.attribs?.class?.includes('username')
    )
  }, permalinkHeaderDom.childNodes, true)
  const permalinkUsername = domutils.getText(permalinkUsernameDom).trim()

  // Get the tweet's content
  const permalinkTweetTextDom = domutils.findOne(node => {
    return (
      node?.attribs?.class?.includes('js-tweet-text-container')
    )
  }, permalinkTweetDom.childNodes, true)
  const permalinkTweetText = domutils.getText(permalinkTweetTextDom).trim()

  assert.strictEqual(('@' + twitterUsername).toLowerCase().trim(), permalinkUsername.toLowerCase().trim())

  // Now that we have the tweet's username and the tweet's contents, instert into the DB
  db.prepare('UPDATE Captures SET username = ?, text= ? WHERE wmDigest = ?').run(permalinkUsername, permalinkTweetText, wmCapture.wmDigest)

  const updatedFetch = db.prepare('SELECT * FROM Captures WHERE wmDigest = ?').get(wmCapture.wmDigest)
  return updatedFetch
}

const main = async () => {
  if (process.argv.length !== 3) {
    console.log('Usage: node index.js <twitterUsername>')
    console.log('Example: node index.js Notch')
    process.exit(1)
  }

  const twitterUsername = process.argv[2].replace('@', '')

  const db = getDb(twitterUsername)

  console.log(`Fetching WaybackMachine captures for <@${twitterUsername}>`)
  let wmCaptures = await fetchWMCaptures(db, twitterUsername)
  console.log(`Fetched ${wmCaptures.length} captures from the WaybackMachine for <@${twitterUsername}>\n`)

  // We could fetch multiple tweets asynchronously, but it's better not to spam The Wayback Machine
  console.log(`Fetching ${wmCaptures.length} tweets\n`)
  for (let i = 0; i < wmCaptures.length; i++) {
    console.log(`Fetching tweet ${wmCaptures[i].wmOriginal} (${i + 1}/${wmCaptures.length})`)
    try {
      console.log(await fetchTwCapture(db, twitterUsername, wmCaptures[i]))
    } catch (err) {
      console.log(`Failed to fetch tweet ${wmCaptures[i].wmOriginal}`)
      console.log(err)
    }
    console.log()
  }
  console.log('Done fetching tweets')

  // Now that everything is fetched into the DB, save as CSV
  wmCaptures = (await fetchWMCaptures(db, twitterUsername)) // Re-fetch DB
    .map(wmCapture => {
      return ({
        ...wmCapture,
        wmLink: `https://web.archive.org/web/${wmCapture.wmTimestamp}/${wmCapture.wmOriginal}`
      })
    })
  try {
    const csvOpts = { csvFields: Object.keys(wmCaptures[0]) }
    const csv = parse(wmCaptures, csvOpts)
    fs.writeFileSync(path.join(__dirname, twitterUsername + '.csv'), csv)
  } catch (err) {
    console.log(err)
  }

  console.log('Done!')
}
main()
