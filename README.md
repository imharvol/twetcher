# Twetcher
Retrieve someone's tweets from The Wayback Machine into a CSV file with a single command.

## Usage
Clone the repository:
```bash
git clone https://github.com/imharvol/twetcher.git
```
1. Clone the repository: `git clone https://github.com/imharvol/twetcher.git`
2. Install dependencies: `npm install`
3. Run! `node index.js <twitterUsername>`

Example: `node index.js elonmusk`

The program will store its progress in a _${USERNAME}.sqlite_ file, so feel free to stop and re-start it.
Once the program is done fetching all the user's tweets, it will create an _${USERNAME}.csv_ with the desired output.